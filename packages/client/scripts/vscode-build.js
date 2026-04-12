const fs = require('fs');
const { execSync } = require('child_process');
const { cp, rm } = require('fs/promises');
const path = require('path');
async function main() {
  const tmpDir = '/tmp/mcx-pack-' + Date.now();
  fs.mkdirSync(tmpDir, { recursive: true });
  const filesToCopy = ['dist', 'syntaxes', 'LICENSE', 'language-configuration.json', 'README.md'];
  filesToCopy.forEach(item => {
    if (fs.existsSync(item)) {
      const stat = fs.statSync(item);
      if (stat.isDirectory()) {
        execSync(`cp -r ${item} ${tmpDir}/`);
      } else {
        execSync(`cp ${item} ${tmpDir}/`);
      }
    }
  });
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const cleanPkg = {
    name: pkg.name,
    version: pkg.version,
    displayName: pkg.displayName,
    description: pkg.description,
    publisher: pkg.publisher,
    license: pkg.license,
    author: pkg.author,
    engines: pkg.engines,
    categories: pkg.categories,
    activationEvents: pkg.activationEvents,
    repository: pkg.repository,
    main: pkg.main,
    files: ['dist', 'syntaxes', 'LICENSE', 'language-configuration.json', 'README.md'],
    contributes: pkg.contributes
  };

  fs.writeFileSync(tmpDir + '/package.json', JSON.stringify(cleanPkg, null, 2));
  try {
    execSync('vsce package --no-dependencies', { stdio: 'inherit', cwd: tmpDir });
    const vsixFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.vsix'));
    if (vsixFiles.length > 0) {
      await cp(path.join(tmpDir, vsixFiles[0]), path.resolve("dist/mcx-vscode-client.vsix"), {
        recursive: true
      })
    }
  } catch (error) {
  } finally {
    await rm(tmpDir, {
      recursive: true,
      force: true
    })
  }
};
main()