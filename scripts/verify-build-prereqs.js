const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const strictFromCli = process.argv.includes('--strict');
const requireMft = process.env.HORUS_REQUIRE_MFT === '1' || strictFromCli;

let hasBlockingError = false;

function resolvePath(relativePath) {
	return path.join(rootDir, relativePath);
}

function exists(relativePath) {
	return fs.existsSync(resolvePath(relativePath));
}

function logInfo(message) {
	console.log(`[build:check] ${message}`);
}

function logWarn(message) {
	console.warn(`[build:check][warn] ${message}`);
}

function logError(message) {
	console.error(`[build:check][error] ${message}`);
	hasBlockingError = true;
}

function checkRequiredPath(relativePath, description) {
	if (!exists(relativePath)) {
		logError(`${description} no encontrado: ${relativePath}`);
		return;
	}
	logInfo(`${description} OK: ${relativePath}`);
}

function run() {
	logInfo('Validando prerequisitos de empaquetado...');

	checkRequiredPath('src/main.js', 'Entry principal de Electron');
	checkRequiredPath('src/preload.js', 'Bridge preload');
	checkRequiredPath('mis_scripts', 'Directorio de scripts');
	checkRequiredPath('assets/icon.ico', 'Icono de aplicacion');

	const mftBinaryRel = 'native_modules/mft_reader/target/release/mft_reader.exe';
	if (!exists(mftBinaryRel)) {
		if (requireMft) {
			logError(`Binario nativo faltante: ${mftBinaryRel}. Ejecuta: npm run build:mft`);
		} else {
			logWarn(`Binario nativo no detectado (${mftBinaryRel}). Se usara fallback en runtime. Para incluirlo ejecuta: npm run build:mft`);
		}
	} else {
		logInfo(`Binario nativo OK: ${mftBinaryRel}`);
	}

	const pythonEnvRel = 'mis_scripts/env_python';
	if (exists(pythonEnvRel)) {
		logWarn(`${pythonEnvRel} existe localmente. El empaquetado lo excluye para mantener instalador ligero.`);
	}

	if (hasBlockingError) {
		logError('Validacion de prerequisitos fallida. Se cancela el build.');
		process.exit(1);
	}

	logInfo('Validacion completada. Build habilitado.');
}

run();
