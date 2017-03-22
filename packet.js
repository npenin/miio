'use strict';

const crypto = require('crypto');
const debug = require('debug')('miio.packet');

class Packet {
	constructor() {
		this.header = Buffer.alloc(2 + 2 + 4 + 4 + 4 + 16);
		this.header[0] = 0x21;
		this.header[1] = 0x31;

		for(let i=4; i<32; i++) {
			this.header[i] = 0xff;
		}
	}

	handshake() {
		this.data = null;
	}

	handleHandshakeReply() {
		this.token = this.checksum;
		this._serverHandshake = Date.now();
	}

	get needsHandshake() {
		// Hopefully temporary, handshake before every command
		return true;

		//return ! this._token || (Date.now() - this._serverHandshake) > 6000;
	}

	get raw() {
		if(this.data) {
			// Send a command to the device
			if(! this._token) {
				throw new Error('Token is required to send commands');
			}

			for(let i=4; i<8; i++) {
				this.header[i] = 0x00;
			}

			// Update the stamp to match server
			if(this._serverStampTime) {
				const secondsPassed = Math.floor(Date.now() - this._serverStampTime) / 1000;
				this.header.writeUInt32BE(this._serverStamp + secondsPassed, 12)
			}

			// Encrypt the data
			let cipher = crypto.createCipheriv('aes-128-cbc', this._tokenKey, this._tokenIV);
			let encrypted = Buffer.concat([
				cipher.update(this.data),
				cipher.final()
			]);

			// Set the length
			this.header.writeUInt16BE(32 + encrypted.length, 2);

			// Calculate the checksum
			let digest = crypto.createHash('md5')
				.update(this.header.slice(0, 16))
				.update(this._token)
				.update(encrypted)
				.digest();
			digest.copy(this.header, 16);

			debug('->', this.header);
			return Buffer.concat([ this.header, encrypted ]);
		} else {
			// Handshake
			this.header.writeUInt16BE(32, 2);

			for(let i=4; i<32; i++) {
				this.header[i] = 0xff;
			}

			debug('->', this.header);
			return this.header;
		}
	}

	set raw(msg) {
		msg.copy(this.header, 0, 0, 32);
		debug('<-', this.header);

		const stamp = this.stamp;
		if(stamp > 0) {
			// If the device return a stamp, store it
			this._serverStamp = this.stamp;
		}

		const encrypted = msg.slice(32);
		if(encrypted.length > 0) {
			let decipher = crypto.createDecipheriv('aes-128-cbc', this._tokenKey, this._tokenIV);
			this.data = Buffer.concat([
				decipher.update(encrypted),
				decipher.final()
			]);
		} else {
			this.data = null;
		}
	}

	get token() {
		return this._token;
	}

	set token(t) {
		this._token = t;
		this._tokenKey = crypto.createHash('md5').update(t).digest();
		this._tokenIV = crypto.createHash('md5').update(this._tokenKey).update(t).digest();
	}

	get checksum() {
		return this.header.slice(16);
	}

	get stamp() {
		return this.header.readUInt32BE(12);
	}
}

module.exports = Packet;