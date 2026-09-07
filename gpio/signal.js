'use strict';

const { Gpio } = require('./index');
const { resolveSignalPins } = require('./pinMap');

/**
 * LEGO 2-aspect (red/green) 12V signal, driven bipolar off 2 GPIOs and a
 * single shared 22ohm pull-up resistor per the brief: driving pin A high
 * and B low (or vice-versa) produces the ±3.3V swing the signal expects,
 * and both-low is the "off" (unlit) state.
 */
class Signal {
  constructor(signalNumber) {
    this.signalNumber = signalNumber;
    const pins = resolveSignalPins(signalNumber);
    this.a = new Gpio(pins.a, 'out');
    this.b = new Gpio(pins.b, 'out');
    this._aspect = 'off';
    this.set('off');
  }

  /** @param {'red'|'green'|'off'} aspect */
  set(aspect) {
    if (!['red', 'green', 'off'].includes(aspect)) {
      throw new Error(`Invalid signal aspect '${aspect}'`);
    }
    this._aspect = aspect;
    if (aspect === 'red') {
      this.a.writeSync(1);
      this.b.writeSync(0);
    } else if (aspect === 'green') {
      this.a.writeSync(0);
      this.b.writeSync(1);
    } else {
      this.a.writeSync(0);
      this.b.writeSync(0);
    }
  }

  get aspect() {
    return this._aspect;
  }

  destroy() {
    this.set('off');
    this.a.unexport();
    this.b.unexport();
  }
}

module.exports = Signal;
