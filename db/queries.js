// Storage backend switch: STORAGE=json (dev mode, no MySQL required) or
// the default 'mysql'. Every other file imports this module and never
// needs to know which backend is actually in use.
const useJson = (process.env.STORAGE || 'mysql').toLowerCase() === 'json';

module.exports = useJson ? require('./jsonQueries') : require('./mysqlQueries');
