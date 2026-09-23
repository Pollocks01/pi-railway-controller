'use strict';

// Mirrors the shuttle firmware's sliderToMotor()/motorToSlider() approach:
// slider 0 -> motor 0, slider ±1..±100 -> motor ±minPercent..±maxPercent.
// Both the floor and the ceiling are configurable
// (Settings.track12vMinMotorPercent / track12vMaxMotorPercent, default 40/80)
// because 12V LEGO motors stall or judder below the floor, and run louder/
// hotter than intended at full Vm above the ceiling.

function sliderToMotor(sliderValue, minMotorPercent, maxMotorPercent = 100) {
  const v = Math.max(-100, Math.min(100, Math.round(sliderValue)));
  if (v === 0) return 0;
  const sign = v > 0 ? 1 : -1;
  const mag = Math.abs(v);
  const m = minMotorPercent + ((mag - 1) * (maxMotorPercent - minMotorPercent)) / 99;
  return sign * Math.max(minMotorPercent, Math.min(maxMotorPercent, Math.round(m)));
}

function motorToSlider(motorValue, minMotorPercent, maxMotorPercent = 100) {
  const v = Math.round(motorValue);
  if (v === 0) return 0;
  const sign = v > 0 ? 1 : -1;
  const mag = Math.abs(v);
  const s = 1 + ((mag - minMotorPercent) * 99) / (maxMotorPercent - minMotorPercent);
  return sign * Math.max(1, Math.min(100, Math.round(s)));
}

module.exports = { sliderToMotor, motorToSlider };
