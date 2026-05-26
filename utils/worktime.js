const time = require('./time')
const model = require('./model')
const calc = require('./calc')
const report = require('./report')

module.exports = Object.assign({}, time, model, calc, report)
