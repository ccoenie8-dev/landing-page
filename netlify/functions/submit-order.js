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

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const body = JSON.parse(event.body);

        const honeypot = body.website;
        if (honeypot && honeypot.trim() !== '') {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Bot detected' })
            };
        }

        if (!body.name || body.name.trim().length < 2) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid name' })
            };
        }

        if (!body.phone || body.phone.trim().length < 10) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Invalid phone' })
            };
        }

        const saPhoneRegex = /^0[67]\d{8}$/;
        const cleanedPhone = body.phone.replace(/[\s\-\(\)]/g, '');
        if (!saPhoneRegex.test(cleanedPhone)) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Please enter a valid South African mobile number' })
            };
        }

        if (!body.flavour) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Please select a flavour' })
            };
        }

        let imageData = null;

        if (body.image && body.image.content) {
            imageData = Buffer.from(body.image.content, 'base64');
            const imageSize = imageData.length;
            const imageFilename = body.image.filename || '';
            const imageContentType = body.image.contentType || '';

            if (imageSize > MAX_IMAGE_SIZE) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Image too large. Maximum size is 5MB' })
                };
            }

            if (imageFilename && !validateExtension(imageFilename)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'Invalid file type. Only JPG and PNG images are allowed' })
                };
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

            if (containsMaliciousContent(imageData, imageFilename)) {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'File contains suspicious content' })
                };
            }

            body.imageContent = imageData.toString('base64');
            body.imageFilename = imageFilename;
            body.imageContentType = imageContentType;
        }

        const resend = new Resend(process.env.RESEND_API_KEY);

        const emailContent = `
New Cake Order Request

Name: ${body.name}
Phone: ${body.phone}
Flavour: ${body.flavour}
Message: ${body.message || 'No additional details'}
${imageData ? '\nNote: An image attachment was included' : ''}
        `.trim();

        const emailOptions = {
            from: 'Cake Orders <onboarding@resend.dev>',
            to: process.env.EMAIL_TO,
            subject: `New Cake Order from ${body.name}`,
            text: emailContent
        };

        if (imageData && body.imageFilename) {
            emailOptions.attachments = [
                {
                    filename: body.imageFilename,
                    content: body.imageContent,
                    contentType: body.imageContentType || 'image/jpeg'
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