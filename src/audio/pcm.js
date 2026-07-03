"use strict";

// Exotel requires PCM chunks that are a multiple of 320 bytes,
// between 3200 and 100000 bytes. We split TTS output into 3200-byte frames
// (100ms @ 16kHz/16-bit mono) for smooth, pace-able playback.
const FRAME_BYTES = 3200;

function base64ToBuffer(payload) {
    return Buffer.from(payload, "base64");
}

function bufferToBase64(buffer) {
    return buffer.toString("base64");
}

/**
 * Split a raw PCM buffer into Exotel-compatible frames (multiple of 320 bytes).
 * The final frame is zero-padded up to a 320-byte boundary.
 */
function splitIntoFrames(buffer, frameBytes = FRAME_BYTES) {
    const frames = [];
    for (let offset = 0; offset < buffer.length; offset += frameBytes) {
        let chunk = buffer.subarray(offset, offset + frameBytes);
        if (chunk.length % 320 !== 0) {
            const padded = Buffer.alloc(Math.ceil(chunk.length / 320) * 320);
            chunk.copy(padded);
            chunk = padded;
        }
        frames.push(chunk);
    }
    return frames;
}

/**
 * Strip a WAV header if present, returning raw PCM samples.
 * Google TTS LINEAR16 returns a WAV container; Exotel wants headerless PCM.
 */
function stripWavHeader(buffer) {
    if (buffer.length > 44 && buffer.toString("ascii", 0, 4) === "RIFF") {
        // Find the "data" sub-chunk.
        let offset = 12;
        while (offset + 8 <= buffer.length) {
            const chunkId = buffer.toString("ascii", offset, offset + 4);
            const chunkSize = buffer.readUInt32LE(offset + 4);
            if (chunkId === "data") {
                return buffer.subarray(offset + 8, offset + 8 + chunkSize);
            }
            offset += 8 + chunkSize;
        }
    }
    return buffer;
}

/**
 * Rough RMS energy of a 16-bit PCM buffer — used for simple silence / speech
 * detection to drive barge-in and end-of-turn.
 */
function rmsEnergy(buffer) {
    if (buffer.length < 2) return 0;
    let sum = 0;
    const samples = buffer.length / 2;
    for (let i = 0; i + 1 < buffer.length; i += 2) {
        const sample = buffer.readInt16LE(i);
        sum += sample * sample;
    }
    return Math.sqrt(sum / samples);
}

module.exports = {
    FRAME_BYTES,
    base64ToBuffer,
    bufferToBase64,
    splitIntoFrames,
    stripWavHeader,
    rmsEnergy,
};
