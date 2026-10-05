/* Shared handoff contract. No kernel implementation is included here. */
(function (global) {
    "use strict";
    var config = global.HOST_PSM_CONFIG;
    var started = false;
    var english = config && config.language === "en";
    function text(pt, en) { return english ? en : pt; }
    function ready() { return !!(config && config.kernel && config.kernel.status === "ready"); }
    function allowed(firmware) {
        return ready() && config.kernel.firmwares.indexOf(firmware) !== -1;
    }
    function label() { return config ? config.payload.label : "PLDMGR"; }
    function error(pt, en) { return new Error(text(pt, en)); }
    function localPath(value, prefix, suffix) {
        return typeof value === "string" && /^[A-Za-z0-9._/-]+$/.test(value) &&
            value.indexOf(prefix) === 0 && value.slice(-suffix.length) === suffix &&
            value.split("/").every(function (part) { return part && part !== "." && part !== ".."; });
    }
    function loadAdapter() {
        return new Promise(function (resolve, reject) {
            if (!localPath(config.kernel.entry, "relapse/", ".js")) {
                reject(error("Entrada ReLapse inválida.", "Invalid ReLapse entry."));
                return;
            }
            var script = document.createElement("script");
            var settled = false;
            var timer = setTimeout(function () { finish(error("Tempo esgotado ao carregar ReLapse.", "ReLapse loading timed out.")); }, 15000);
            function finish(failure) {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                script.onload = script.onerror = null;
                if (failure) { script.remove(); reject(failure); return; }
                var adapter = global.HostPSMIntegration;
                if (!adapter || adapter.apiVersion !== 1 ||
                    typeof adapter.prepareUserland !== "function" ||
                    typeof adapter.runKernel !== "function" || typeof adapter.loadElf !== "function") {
                    reject(error("Integração ReLapse incompleta.", "Incomplete ReLapse integration."));
                    return;
                }
                resolve(adapter);
            }
            script.onload = function () { finish(null); };
            script.onerror = function () { finish(error("Não foi possível carregar ReLapse.", "Could not load ReLapse.")); };
            script.src = config.kernel.entry;
            document.head.appendChild(script);
        });
    }
    function fetchPayload() {
        return new Promise(function (resolve, reject) {
            var payload = config.payload;
            if (!localPath(payload.url, "payloads/", ".elf") || !Number.isInteger(payload.bytes) ||
                payload.bytes < 64 || payload.bytes > 32 * 1024 * 1024) {
                reject(error("Configuração de ELF inválida.", "Invalid ELF configuration."));
                return;
            }
            var request = new XMLHttpRequest();
            request.open("GET", payload.url, true);
            request.responseType = "arraybuffer";
            request.timeout = 30000;
            request.onerror = request.ontimeout = request.onabort = function () {
                reject(error("Falha ao obter o ELF.", "Could not retrieve the ELF."));
            };
            request.onload = function () {
                var bytes = request.response && new Uint8Array(request.response);
                if (request.status !== 200 || !bytes || bytes.length !== payload.bytes ||
                    bytes[0] !== 127 || bytes[1] !== 69 || bytes[2] !== 76 || bytes[3] !== 70 ||
                    bytes[4] !== 2 || bytes[5] !== 1 || bytes[18] !== 62 || bytes[19] !== 0) {
                    reject(error("ELF ausente, incompleto ou incompatível.", "ELF is missing, incomplete or incompatible."));
                    return;
                }
                resolve(bytes);
            };
            request.send();
        });
    }
    async function start(options) {
        if (started) throw error("Fluxo já iniciado.", "Flow already started.");
        if (!allowed(options.firmware) || !options.offsets) {
            throw error("Kernel sem homologação para este firmware.", "Kernel is not validated for this firmware.");
        }
        started = true;
        var report = options.onStage;
        report(2, "running");
        var adapter = await loadAdapter();
        var userland = await adapter.prepareUserland({firmware: options.firmware, offsets: options.offsets});
        if (!userland) throw error("Userland não forneceu contexto de execução.", "Userland did not provide an execution context.");
        report(2, "done");
        report(3, "running");
        var kernel = await adapter.runKernel(userland);
        if (!kernel) throw error("Kernel não forneceu contexto de execução.", "Kernel did not provide an execution context.");
        report(3, "done");
        report(4, "running");
        var bytes = await fetchPayload();
        await adapter.loadElf(kernel, bytes, {role: config.role, url: config.payload.url, firmware: options.firmware});
        report(4, "done");
    }
    function applyIdentity() {
        var version = document.querySelector("[data-host-psm-version-label]");
        var meta = document.querySelector('meta[name="host-psm-version"]');
        if (version && meta) version.textContent = text("VERSÃO ", "VERSION ") + meta.content;
        var stage = document.querySelector("#step-4 .step-name");
        if (stage) stage.textContent = label();
        if (config && config.role === "installer") {
            document.getElementById("brand").lastChild.textContent = " " + label();
            document.getElementById("page-title").textContent = "WebKit + ReLapse + " + label();
            document.title = "PS5 / WEBKIT-RELAPSE-" + label();
        }
    }
    global.HostPSM = Object.freeze({ready: ready, allowed: allowed, label: label, text: text, start: start, applyIdentity: applyIdentity});
})(window);
