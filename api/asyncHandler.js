'use strict';

// Express 4 does not automatically catch rejected promises from async route
// handlers -- an unhandled rejection would otherwise crash the process
// instead of reaching jsonErrorHandler. Wrap every async handler with this.
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = asyncHandler;
