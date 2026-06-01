const { Resend } = require('resend');

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];

const MAGIC_BYTES = {
    'jpeg': [0xFF, 0xD8, 0xFF],
    'png': [0x89, 0x50, 0x4E, 0x47]
};

function getExtension(filename) {
    const lastDot = filename.lastIndexOf('.');
    return lastDot !== -1 ? filename.substring(lastDot).toLowerCase() : '';
}

function validateExtension(filename) {
    const ext = getExtension(filename);
    return ALLOWED_EXTENSIONS.includes(ext);
}

function validateMimeType(mimeType) {
    return ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase());
}

function validateMagicBytes(data) {
    if (!data || data.length < 8) return false;
    const bytes = Array.from(new Uint8Array(data.slice(0, 8)));
    for (const [, magic] of Object.entries(MAGIC_BYTES)) {
        if (bytes.slice(0, magic.length).every((byte, i) => byte === magic[i])) {
            return true;
        }
    }
    return false;
}

function containsMaliciousContent(data, filename) {
    const ext = getExtension(filename).toLowerCase();
    const strData = new TextDecoder().decode(data.slice(0, 1000));
    const patterns = [
        /<\?php/i,
        /<script/i,
        /<html/i,
        /javascript:/i,
        /onerror=/i,
        /onload=/i,
        /eval\(/i,
        /base64/i,
        /\\x[0-9a-f]{2}/i
    ];
    return patterns.some(pattern => pattern.test(strData));
}

function getBoundary(contentType) {
    const match = contentType.match(/boundary=([^;]+)/);
    if (!match) return null;
    return match[1].replace(/^"|"$/g, '');
}

function parseFormData(body, contentType) {
    const boundary = getBoundary(contentType);
    if (!boundary) {
        return { fields: {}, imageData: null, imageFilename: null, imageContentType: null, imageSize: 0 };
    }

    const delimiter = `--${boundary}`;
    const parts = body.split(delimiter);

    const fields = {};
    let imageData = null;
    let imageFilename = null;
    let imageContentType = null;
    let imageSize = 0;

    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed === '' || trimmed === '--' || !part.includes('Content-Disposition')) continue;

        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;

        const headers = part.substring(0, headerEnd);
        const content = part.substring(headerEnd + 4);

        const nameMatch = headers.match(/name="([^"]+)"/);
        if (!nameMatch) continue;
        const name = nameMatch[1];

        const filenameMatch = headers.match(/filename="([^"]+)"/);
        const ctMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);

        if (filenameMatch) {
            imageFilename = filenameMatch[1];
            imageContentType = ctMatch ? ctMatch[1].trim() : 'application/octet-stream';
            const cleanContent = content.replace(/\r\n--\s*$/, '').replace(/\r\n$/, '');
            imageData = Buffer.from(cleanContent, 'binary');
            imageSize = imageData.length;
        } else {
            fields[name] = content.replace(/\r\n$/, '').trim();
        }
    }

    return { fields, imageData, imageFilename, imageContentType, imageSize };
}

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const contentType = event.headers['content-type'] || '';

        if (!contentType.includes('multipart/form-data')) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid content type' })
            };
        }

        const rawBody = event.isBase64Encoded
            ? Buffer.from(event.body, 'base64').toString('binary')
            : event.body;
        const { fields, imageData, imageFilename, imageContentType, imageSize } = parseFormData(rawBody, contentType);

        const honeypot = fields.website;
        if (honeypot && honeypot.trim() !== '') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Bot detected' })
            };
        }

        if (!fields.name || fields.name.trim().length < 2) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid name' })
            };
        }

        if (!fields.phone || fields.phone.trim().length < 10) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid phone' })
            };
        }

        const saPhoneRegex = /^0[67]\d{8}$/;
        const cleanedPhone = fields.phone.replace(/[\s\-\(\)]/g, '');
        if (!saPhoneRegex.test(cleanedPhone)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Please enter a valid South African mobile number' })
            };
        }

        if (!fields.flavour) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Please select a flavour' })
            };
        }

        if (imageData) {
            if (imageSize > MAX_IMAGE_SIZE) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Image too large. Maximum size is 3MB' })
                };
            }

            if (imageFilename) {
                if (!validateExtension(imageFilename)) {
                    return {
                        statusCode: 400,
                        body: JSON.stringify({ error: 'Invalid file type. Only JPG and PNG images are allowed' })
                    };
                }
            }

            if (imageContentType && !validateMimeType(imageContentType)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Invalid image format' })
                };
            }

            if (!validateMagicBytes(imageData)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Invalid image file' })
                };
            }

            if (containsMaliciousContent(imageData, imageFilename || '')) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'File contains suspicious content' })
                };
            }
        }

        const resend = new Resend(process.env.RESEND_API_KEY);

        const emailContent = `
New Cake Order Request

Name: ${fields.name}
Phone: ${fields.phone}
Flavour: ${fields.flavour}
Message: ${fields.message || 'No additional details'}
${imageData ? '\nNote: An image attachment was included' : ''}
        `.trim();

        const emailOptions = {
            from: 'Cake Orders <onboarding@resend.dev>',
            to: process.env.EMAIL_TO,
            subject: `New Cake Order from ${fields.name}`,
            text: emailContent
        };

        if (imageData && imageFilename) {
            emailOptions.attachments = [
                {
                    filename: imageFilename,
                    content: imageData.toString('base64'),
                    contentType: imageContentType || 'image/jpeg'
                }
            ];
        }

        await resend.emails.send(emailOptions);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, message: 'Order submitted successfully' })
        };
    } catch (error) {
        console.error('Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process request' })
        };
    }
};