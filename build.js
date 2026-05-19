const fs = require('fs');
const path = require('path');

const email = process.env.EMAIL_ADDRESS || 'ccoenie8@gmail.com';
const phone = process.env.PHONE_NUMBER || '074 134 5051';
const address = process.env.ADDRESS || '13 Jacaranda street, Swellendam, 6740';
const facebookUrl = process.env.FACEBOOK_URL || '';
const srcDir = '.';
const distDir = 'dist';
const excludeDirs = ['dist', 'node_modules', '.next', '.git'];
const excludeFiles = ['build.js'];

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (excludeDirs.includes(entry.name)) continue;
    if (excludeFiles.includes(entry.name)) continue;
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      const content = fs.readFileSync(srcPath);
      if (entry.name.endsWith('.html')) {
        const text = content.toString()
          .replace(/\{\{EMAIL_ADDRESS\}\}/g, email)
          .replace(/\{\{PHONE_NUMBER\}\}/g, phone)
          .replace(/\{\{ADDRESS\}\}/g, address)
          .replace(/\$\{FACEBOOK_URL\}/g, facebookUrl);
        fs.writeFileSync(destPath, text);
      } else {
        fs.writeFileSync(destPath, content);
      }
    }
  }
}

copyDir(srcDir, distDir);
console.log(`Built to ${distDir} with email: ${email}`);