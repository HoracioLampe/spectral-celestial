// services/encryption.js
// Encryption service for storing private keys securely in database

const crypto = require('crypto');

class EncryptionService {
    constructor() {
        this.algorithm = 'aes-256-gcm';
        this.key = this.deriveKey();
    }

    deriveKey() {
        const secret = process.env.ENCRYPTION_KEY;
        if (!secret) {
            throw new Error('ENCRYPTION_KEY not set in environment variables');
        }
        // Derive a 32-byte key from the secret
        return crypto.scryptSync(secret, 'salt', 32);
    }

    encrypt(text) {
        try {
            const iv = crypto.randomBytes(16);
            const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);

            let encrypted = cipher.update(text, 'utf8', 'hex');
            encrypted += cipher.final('hex');

            const authTag = cipher.getAuthTag();

            // Return: iv:authTag:encrypted
            return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
        } catch (e) {
            console.error('❌ Encryption failed:', e.message);
            throw new Error('Failed to encrypt data');
        }
    }

    decrypt(encryptedData) {
        try {
            const parts = encryptedData.split(':');
            if (parts.length !== 3) {
                throw new Error('Invalid encrypted data format');
            }

            const iv = Buffer.from(parts[0], 'hex');
            const authTag = Buffer.from(parts[1], 'hex');
            const encrypted = parts[2];

            const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
            decipher.setAuthTag(authTag);

            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');

            return decrypted;
        } catch (e) {
            console.error('❌ Decryption failed:', e.message);
            throw new Error('Failed to decrypt data');
        }
    }
}

module.exports = new EncryptionService();
