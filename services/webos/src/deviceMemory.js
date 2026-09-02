// How much RAM this TV actually has.
//
// A 2016 webOS 3 set can ship with 624 MB of total RAM and under 300 MB free
// with the launcher resident. The peer and buffer budgets in this runtime were
// tuned on an OLED C9, which has several times that; on the small sets the same
// budget makes the first two minutes of playback stutter and sometimes drops
// video entirely while audio keeps going, because the decoder is competing with
// the swarm for memory it does not have.
//
// Node 0.12 has no os.totalmem worth trusting inside the webOS sandbox, so read
// /proc/meminfo directly. The value cannot change while the service lives, so
// read it once.

var fs = require("fs");

// Below this the set is small enough that the default budgets do not fit.
// 1 GiB in kB, as /proc/meminfo reports it.
var LOW_MEMORY_TOTAL_KB = 1024 * 1024;

var cached = null;

function readMemInfoField(text, field) {
  var match = String(text || "").match(new RegExp("^" + field + ":\\s*(\\d+)\\s*kB", "m"));
  if (!match) {
    return 0;
  }
  var value = Number(match[1]);
  return isFinite(value) && value > 0 ? value : 0;
}

function read() {
  var text = "";
  try {
    text = fs.readFileSync("/proc/meminfo", "utf8");
  } catch (error) {
    // Not Linux, or the sandbox denied the read. Say nothing rather than
    // guessing "low" and throttling a set that does not need it.
    return {
      known: false,
      memTotalKb: 0,
      memAvailableKb: 0,
      lowMemory: false
    };
  }
  var memTotalKb = readMemInfoField(text, "MemTotal");
  // MemAvailable only exists from Linux 3.14 up; MemFree is the fallback and is
  // pessimistic, which is the safe direction here.
  var memAvailableKb = readMemInfoField(text, "MemAvailable") || readMemInfoField(text, "MemFree");
  return {
    known: memTotalKb > 0,
    memTotalKb: memTotalKb,
    memAvailableKb: memAvailableKb,
    lowMemory: memTotalKb > 0 && memTotalKb < LOW_MEMORY_TOTAL_KB
  };
}

function getDeviceMemoryProfile() {
  if (!cached) {
    cached = read();
  }
  return cached;
}

module.exports = {
  LOW_MEMORY_TOTAL_KB: LOW_MEMORY_TOTAL_KB,
  getDeviceMemoryProfile: getDeviceMemoryProfile
};
