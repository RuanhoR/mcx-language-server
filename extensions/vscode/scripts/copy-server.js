const fs = require('fs');
const path = require('path');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

const srcServer = path.join(__dirname, '..', 'packages', 'server', 'dist');
const destServer = path.join(__dirname, 'dist', 'server');

if (fs.existsSync(destServer)) {
  fs.rmSync(destServer, { recursive: true });
}

if (fs.existsSync(srcServer)) {
  copyDir(srcServer, destServer);
  console.log('Server copied to dist/server');
} else {
  console.log('Server dist not found at', srcServer);
  process.exit(1);
}