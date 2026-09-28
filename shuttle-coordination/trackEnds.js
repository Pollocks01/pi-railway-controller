'use strict';

/** The east/west end concept is shared by 4.5V shuttle lines and 12V 'length' tracks alike. */
function oppositeEnd(end) {
  return end === 'east' ? 'west' : 'east';
}

module.exports = { oppositeEnd };
