import re

with open('src/renderer.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix malformed renderVirtualDiskList (missing closing braces)
malformed_pattern = r'''                        row\.addEventListener\('click', \(\) => {
                                if \(!item\.fullPath\) return;
                                if \(item\.fullPath\.toLowerCase\(\) === currentPath\.toLowerCase\(\)\) return;
                                if \(isDir\) {
                                    ejecutarEscaneoFantasma\(item\.fullPath, true\);
                                }
                        }\);
                        fragment\.appendChild\(row\);

        renderSlice\(\);
}'''

corrected_pattern = '''                        row.addEventListener('click', () => {
                                if (!item.fullPath) return;
                                if (item.fullPath.toLowerCase() === currentPath.toLowerCase()) return;
                                if (isDir) {
                                    ejecutarEscaneoFantasma(item.fullPath, true);
                                }
                        });
                        fragment.appendChild(row);
                }
                layer.appendChild(fragment);
        };

        viewport.addEventListener('scroll', () => {
                if (rafId) return;
                rafId = window.requestAnimationFrame(renderSlice);
        }, { passive: true });

        renderSlice();
}'''

content = content.replace(malformed_pattern, corrected_pattern)

with open('src/renderer.js', 'w', encoding='utf-8') as f:
    f.write(content)
