const sizeRegex = /size|tamaÃ±o|tamano/i;
const attrRegex = /attributes|atributos/i;
console.log('tamaÃ±o matches:', sizeRegex.test('Tamaño'));
console.log('tamaño matches:', /size|tamaño|tamano/i.test('Tamaño'));
