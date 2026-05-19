(function() {
    'use strict';

    const RATE_LIMIT_KEY = 'sweetLayers_rateLimit';
    const RATE_LIMIT_WINDOW = 60 * 60 * 1000;
    const RATE_LIMIT_MAX = 3;

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
    const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
    const MAX_FILE_SIZE = 5 * 1024 * 1024;

    const MAGIC_BYTES = {
        'jpeg': [0xFF, 0xD8, 0xFF],
        'png': [0x89, 0x50, 0x4E, 0x47]
    };

    function showMessage(message, type) {
        const formMessage = document.getElementById('formMessage');
        if (formMessage) {
            formMessage.textContent = message;
            formMessage.className = 'form-message ' + type;
            formMessage.style.display = 'block';
            setTimeout(() => {
                formMessage.style.display = 'none';
            }, 5000);
        }
    }

    function checkRateLimit() {
        const now = Date.now();
        const data = JSON.parse(localStorage.getItem(RATE_LIMIT_KEY) || '{"submissions": []}');

        data.submissions = data.submissions.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);

        if (data.submissions.length >= RATE_LIMIT_MAX) {
            return false;
        }

        data.submissions.push(now);
        localStorage.setItem(RATE_LIMIT_KEY, JSON.stringify(data));
        return true;
    }

    function validateFileExtension(filename) {
        const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
        return ALLOWED_EXTENSIONS.includes(ext);
    }

    function validateFileMimeType(mimeType) {
        return ALLOWED_MIME_TYPES.includes(mimeType.toLowerCase());
    }

    async function validateFileMagicBytes(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                const arrayBuffer = e.target.result;
                const uint8Array = new Uint8Array(arrayBuffer);
                const bytes = Array.from(uint8Array.slice(0, 8));

                let isValid = false;
                for (const [type, magic] of Object.entries(MAGIC_BYTES)) {
                    if (bytes.slice(0, magic.length).every((byte, i) => byte === magic[i])) {
                        isValid = true;
                        break;
                    }
                }

                resolve(isValid);
            };
            reader.onerror = () => resolve(false);

            const slice = file.slice(0, 8);
            reader.readAsArrayBuffer(slice);
        });
    }

    async function validateImage(file) {
        if (!file) return true;

        if (file.size > MAX_FILE_SIZE) {
            showMessage('File too large. Maximum size is 5MB.', 'error');
            return false;
        }

        if (!validateFileExtension(file.name)) {
            showMessage('Invalid file type. Only JPG, PNG, GIF, and WebP images are allowed.', 'error');
            return false;
        }

        if (!validateFileMimeType(file.type)) {
            showMessage('Invalid file format. Only image files are allowed.', 'error');
            return false;
        }

        const isValidMagicBytes = await validateFileMagicBytes(file);
        if (!isValidMagicBytes) {
            showMessage('File appears to be corrupted or invalid. Please upload a valid image.', 'error');
            return false;
        }

        return true;
    }

    function validateForm() {
        const name = document.getElementById('name');
        const phone = document.getElementById('phone');
        const flavour = document.getElementById('flavour');
        const honeypot = document.getElementById('website');

        if (honeypot && honeypot.value.trim() !== '') {
            showMessage('Submission blocked. Bot detected.', 'warning');
            return false;
        }

        if (name && name.value.trim().length < 2) {
            showMessage('Please enter a valid name (at least 2 characters).', 'error');
            return false;
        }

        if (phone && phone.value.trim().length < 10) {
            showMessage('Please enter a valid phone number.', 'error');
            return false;
        }

        if (flavour && flavour.value === '') {
            showMessage('Please select a cake flavour.', 'error');
            return false;
        }

        return true;
    }

    document.addEventListener('DOMContentLoaded', function() {
        const facebookLink = document.querySelector('[data-social="facebook"]');
        const facebookMeta = document.querySelector('meta[name="facebook-url"]');
        if (facebookLink && facebookMeta) {
            facebookLink.href = facebookMeta.getAttribute('content') || '#';
        }

        const hamburger = document.querySelector('.hamburger');
        const navLinks = document.querySelector('.nav-links');

        if (hamburger) {
            hamburger.addEventListener('click', function() {
                navLinks.classList.toggle('active');
            });
        }

        const filterButtons = document.querySelectorAll('.filter-btn');
        const galleryItems = document.querySelectorAll('.gallery-item');

        if (filterButtons.length > 0) {
            filterButtons.forEach(button => {
                button.addEventListener('click', function() {
                    filterButtons.forEach(btn => btn.classList.remove('active'));
                    this.classList.add('active');

                    const filter = this.getAttribute('data-filter');

                    galleryItems.forEach(item => {
                        if (filter === 'all' || item.getAttribute('data-category') === filter) {
                            item.style.display = 'block';
                        } else {
                            item.style.display = 'none';
                        }
                    });
                });
            });
        }

        const lightbox = document.querySelector('.lightbox');
        const lightboxImg = document.querySelector('.lightbox img');
        const lightboxClose = document.querySelector('.lightbox-close');
        const galleryItemImages = document.querySelectorAll('.gallery-item img');

        if (lightbox && galleryItemImages.length > 0) {
            galleryItemImages.forEach(img => {
                img.parentElement.addEventListener('click', function() {
                    const src = this.querySelector('img').src;
                    lightboxImg.src = src;
                    lightbox.classList.add('active');
                    document.body.style.overflow = 'hidden';
                });
            });

            if (lightboxClose) {
                lightboxClose.addEventListener('click', function() {
                    lightbox.classList.remove('active');
                    document.body.style.overflow = 'auto';
                });
            }

            lightbox.addEventListener('click', function(e) {
                if (e.target === lightbox) {
                    lightbox.classList.remove('active');
                    document.body.style.overflow = 'auto';
                }
            });

            document.addEventListener('keydown', function(e) {
                if (e.key === 'Escape' && lightbox.classList.contains('active')) {
                    lightbox.classList.remove('active');
                    document.body.style.overflow = 'auto';
                }
            });
        }

        const cakeForm = document.getElementById('cakeForm');
        const imageInput = document.getElementById('image');

        if (cakeForm) {
            cakeForm.addEventListener('submit', async function(e) {
                e.preventDefault();

                if (!checkRateLimit()) {
                    showMessage('Too many submissions. Please try again in 1 hour.', 'error');
                    return;
                }

                if (!validateForm()) {
                    return;
                }

                if (imageInput && imageInput.files && imageInput.files.length > 0) {
                    const isValid = await validateImage(imageInput.files[0]);
                    if (!isValid) {
                        return;
                    }
                }

                const submitBtn = document.getElementById('submitBtn');
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.textContent = 'Sending...';
                }

                const inputs = cakeForm.querySelectorAll('input, select, textarea');
                inputs.forEach(input => input.disabled = true);

                fetch('/.netlify/functions/submit-order', {
                    method: 'POST',
                    body: new FormData(cakeForm)
                }).then(response => {
                    if (response.ok) {
                        showMessage('Thank you! Your cake request has been submitted. We\'ll be in touch soon!', 'success');
                        cakeForm.reset();
                    } else {
                        return response.json().then(err => {
                            throw new Error(err.error || 'Unknown error');
                        });
                    }
                }).catch(error => {
                    showMessage(error.message || 'Something went wrong. Please try again or contact us directly.', 'error');
                }).finally(() => {
                    if (submitBtn) {
                        submitBtn.disabled = false;
                        submitBtn.textContent = 'Submit Request';
                    }
                    inputs.forEach(input => input.disabled = false);
                });
            });
        }
    });
})();