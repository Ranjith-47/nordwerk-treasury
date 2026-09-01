const serverless = require("serverless-http");
const app = require("../../backend/srv/server");

module.exports.handler = serverless(app);
