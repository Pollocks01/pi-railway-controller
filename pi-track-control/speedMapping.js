'use strict';

// Mirrors the shuttle firmware's sliderToMotor()/motorToSlider() approach:
// slider 0 -> motor 0, slider ±1..±100 -> motor ±minPercent..±100. The
// minimum-percent floor is configurable (Settings.train12vMinMotorPercent,
// default 40) because 12V LEGO motors stall or judder below that.

function sliderToMotor(sliderValue, minMotorPercent) {
  const v = Math.max(-100, Math.min(100, Math.round(sliderValue)));
  if (v === 0) return 0;
  const sign = v > 0 ? 1 : -1;
  const mag = Math.abs(v);
  const m = minMotorPercent + ((mag - 1) * (100 - minMotorPercent)) / 99;
  return sign * Math.max(minMotorPercent, Math.min(100, Math.round(m)));
}

function motorToSlider(motorValue, minMotorPercent) {
  const v = Math.round(motorValue);
  if (v === 0) return 0;
  const sign = v > 0 ? 1 : -1;
  const mag = Math.abs(v);
  const s = 1 + ((mag - minMotorPercent) * 99) / (100 - minMotorPercent);
  return sign * Math.max(1, Math.min(100, Math.round(s)));
}

module.exports = { sliderToMotor, motorToSlider };
