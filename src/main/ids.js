// Identificadores cortos para elementos, espacios y grupos.
const crypto = require('crypto');

const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

module.exports = { newId };
