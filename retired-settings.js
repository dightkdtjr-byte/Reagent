"use strict";
const fs = require('fs');
const path = require('path');

// Only the former connection's dedicated files are removed. Never load or
// decrypt credentials; never recurse or touch inventory, attachments or backups.
function cleanupRetiredSettings(directory, fileSystem = fs) {
  const removed = [], failures = [];
  for (const name of ['ai-connection.json', 'ai-connection.json.tmp']) {
    try {
      fileSystem.unlinkSync(path.join(directory, name));
      removed.push(name);
    } catch (error) {
      if (error.code !== 'ENOENT') failures.push({name, code:String(error.code || 'UNKNOWN')});
    }
  }
  return {ok:failures.length === 0, removed, failures};
}
module.exports = {cleanupRetiredSettings};
