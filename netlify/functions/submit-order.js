const { Resend } = require('resend');

exports.handler = async (event, context) => {
    if (event.httpMethod !== 'POST') {
        return {
            statusCode: 405,
            body: JSON.stringify({ error: 'Method not allowed' })
        };
    }

    try {
        const formData = new URLSearchParams(event.body);
        const fields = {};
        let imageData = null;

        for (const [key, value] of formData.entries()) {
            if (key === 'image') {
                imageData = value;
            } else {
                fields[key] = value;
            }
        }

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

        if (!fields.flavour) {
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Please select a flavour' })
            };
        }

        const resend = new Resend(process.env.RESEND_API_KEY);

        const emailContent = `
New Cake Order Request

Name: ${fields.name}
Phone: ${fields.email}
Flavour: ${fields.flavour}
Message: ${fields.message || 'No additional details'}
${imageData ? '\nNote: An image attachment was included' : ''}
        `.trim();

        await resend.emails.send({
            from: 'Cake Orders <onboarding@resend.dev>',
            to: process.env.EMAIL_TO || 'hello@sweetlayers.com',
            subject: `New Cake Order from ${fields.name}`,
            text: emailContent
        });

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