module.exports = {
    apps: [
        {
            name: "voice-stream-server",
            script: "src/index.js",
            instances: 1,
            exec_mode: "fork",
            max_memory_restart: "400M",
            env: {
                NODE_ENV: "production",
            },
            // Keep long-lived WebSockets alive; don't kill on idle.
            kill_timeout: 10000,
        },
    ],
};
