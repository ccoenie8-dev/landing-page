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

function parseFormData(body) {
    const fields = {};
    let imageData = null;
    let imageFilename = null;
    let imageContentType = null;
    let imageSize = 0;

    const parts = body.split('----FormBoundary');

    for (const part of parts) {
        if (!part.includes('Content-Disposition')) continue;

        const nameMatch = part.match(/name="([^"]+)"/);
        const filenameMatch = part.match(/filename="([^"]+)"/);
        const contentTypeMatch = part.match(/Content-Type: ([^\r\n]+)/);

        if (!nameMatch) continue;

        const name = nameMatch[1];

        if (filenameMatch) {
            imageFilename = filenameMatch[1];
            if (contentTypeMatch) {
                imageContentType = contentTypeMatch[1];
            }
            const dataMatch = part.match(/\r\n\r\n([\s\S]*?)\r\n?$/);
            if (dataMatch) {
                const base64Data = dataMatch[1].trim();
                try {
                    imageData = Buffer.from(base64Data, 'base64');
                    imageSize = imageData.length;
                } catch (e) {
                    imageData = null;
                }
            }
        } else {
            const valueMatch = part.match(/\r\n\r\n([\s\S]*?)$/);
            if (valueMatch) {
                fields[name] = valueMatch[1].trim();
            }
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

        const { fields, imageData, imageFilename, imageContentType, imageSize } = parseFormData(event.body);

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