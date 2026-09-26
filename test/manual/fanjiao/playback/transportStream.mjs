import { createDecipheriv } from 'node:crypto';

// 保留 TS/PES 头和时间戳，仅处理已取得会话密钥的媒体载荷。
const packetSize = 188;

function packetsFrom(data) {
    if (!data.length || data.length % packetSize) throw new Error('Invalid TS length');
    const packets = [];
    for (let offset = 0; offset < data.length; offset += packetSize) {
        if (data[offset] !== 0x47) throw new Error('Invalid TS sync byte');
        const control = (data[offset + 3] >> 4) & 3;
        if (!control) throw new Error('Invalid TS adaptation control');
        const start = offset + (control & 2 ? 5 + data[offset + 4] : 4);
        if (start > offset + packetSize) throw new Error('Invalid TS adaptation length');
        packets.push({ pid: ((data[offset + 1] & 31) << 8) | data[offset + 2],
            unitStart: !!(data[offset + 1] & 64), start, end: offset + packetSize,
            payload: control & 1 ? data.subarray(start, offset + packetSize) : Buffer.alloc(0) });
    }
    return packets;
}

// PSI 表可跨 TS 包；依据 pointer field 拼接，而不是假定首包含完整 PAT/PMT。
function sectionsFor(packets, pid, tableId) {
    let pending = Buffer.alloc(0);
    const result = [];
    const drain = () => {
        while (pending.length) {
            if (pending[0] === 255) { pending = pending.subarray(1); continue; }
            if (pending.length < 3) break;
            const length = ((pending[1] & 15) << 8) | pending[2];
            if (length < 4 || length > 4093) throw new Error('Invalid PSI section');
            if (pending.length < length + 3) break;
            if (pending[0] === tableId) result.push(pending.subarray(0, length + 3));
            pending = pending.subarray(length + 3);
        }
    };
    for (const packet of packets) {
        if (packet.pid !== pid || !packet.payload.length) continue;
        const bytes = packet.payload;
        if (packet.unitStart) {
            const pointer = bytes[0];
            if (pointer + 1 > bytes.length) throw new Error('Invalid PSI pointer');
            if (pending.length && pointer) {
                pending = Buffer.concat([pending, bytes.subarray(1, pointer + 1)]);
                drain();
            }
            pending = bytes.subarray(pointer + 1);
        } else if (pending.length) pending = Buffer.concat([pending, bytes]);
        else continue;
        drain();
    }
    return result;
}

function streamsFrom(packets) {
    const pmtPids = new Set();
    for (const section of sectionsFor(packets, 0, 0)) {
        for (let offset = 8; offset + 4 <= section.length - 4; offset += 4) {
            if (section.readUInt16BE(offset)) pmtPids.add(((section[offset + 2] & 31) << 8) | section[offset + 3]);
        }
    }
    const streams = new Map();
    for (const pmtPid of pmtPids) {
        for (const section of sectionsFor(packets, pmtPid, 2)) {
            if (section.length < 16) continue;
            let offset = 12 + (((section[10] & 15) << 8) | section[11]);
            while (offset + 5 <= section.length - 4) {
                const pid = ((section[offset + 1] & 31) << 8) | section[offset + 2];
                streams.set(pid, section[offset]);
                offset += 5 + (((section[offset + 3] & 15) << 8) | section[offset + 4]);
            }
        }
    }
    if (!streams.size) throw new Error('No elementary streams in TS');
    return streams;
}

export function inspectTransportStream(data) {
    return [...streamsFrom(packetsFrom(data))].map(([pid, type]) => ({ pid, type,
        codec: ({ 15: 'AAC ADTS', 17: 'AAC LATM', 27: 'H264' })[type] || 'unknown' }));
}

// 按每条流的 PES 边界处理完整加密块，尾部不足 16 字节保持原样。
export function decryptTransportStream(data, key) {
    if (key.length !== 16) throw new Error('Invalid media key length');
    const packets = packetsFrom(data);
    const streams = streamsFrom(packets);
    const output = Buffer.from(data);
    const active = new Map();
    const finish = pid => {
        const ranges = active.get(pid);
        active.delete(pid);
        const combined = Buffer.concat(ranges.map(([start, end]) => data.subarray(start, end)));
        const fullLength = Math.floor(combined.length / 16) * 16;
        if (!fullLength) return;
        const decipher = createDecipheriv('aes-128-ecb', key, null).setAutoPadding(false);
        const clear = Buffer.concat([decipher.update(combined.subarray(0, fullLength)), decipher.final()]);
        let position = 0;
        for (const [start, end] of ranges) {
            const length = Math.min(end - start, fullLength - position);
            if (length <= 0) break;
            clear.copy(output, start, position, position + length);
            position += length;
        }
    };
    for (const packet of packets) {
        if (!streams.has(packet.pid) || !packet.payload.length) continue;
        if (packet.unitStart) {
            if (active.has(packet.pid)) finish(packet.pid);
            const payload = packet.payload;
            const headerLength = payload.length >= 9 && payload[0] === 0 && payload[1] === 0 && payload[2] === 1
                ? Math.min(payload.length, 9 + payload[8]) : 0;
            if (packet.start + headerLength < packet.end) active.set(packet.pid, [[packet.start + headerLength, packet.end]]);
        } else if (active.has(packet.pid)) active.get(packet.pid).push([packet.start, packet.end]);
    }
    for (const pid of [...active.keys()]) finish(pid);
    return output;
}
