"use strict";

const mongoose = require("mongoose");
const config = require("./config");
const logger = require("./logger");

let connected = false;

async function connectDb() {
    if (connected) return mongoose.connection;
    if (!config.mongoUri) {
        logger.warn("MONGO_URI not set — session logging disabled");
        return null;
    }

    mongoose.set("strictQuery", false);
    await mongoose.connect(config.mongoUri, {
        serverSelectionTimeoutMS: 10000,
    });
    connected = true;
    logger.info("MongoDB connected");
    return mongoose.connection;
}

function isConnected() {
    return connected && mongoose.connection.readyState === 1;
}

module.exports = { connectDb, isConnected };
