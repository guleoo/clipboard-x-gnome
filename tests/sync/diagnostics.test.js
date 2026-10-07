import {stage} from '../../src/sync/http/diagnostics.js';

function assert(condition, message) {
  if (!condition)
    throw new Error(message);
}

stage(null, 'no-observer');
stage({}, 'missing-method');
const observer = {
  names: [],
  stage(name) { this.names.push(name); },
};
stage(observer, 'cleanup');
assert(observer.names.join() === 'cleanup', 'diagnostics must preserve receiver and stage name');
stage({stage() { throw new Error('observer failed'); }}, 'cleanup');
