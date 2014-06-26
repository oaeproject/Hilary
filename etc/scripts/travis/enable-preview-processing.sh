#!/bin/bash

echo >> ~/build/oaeproject/Hilary/config.js << EOF

config.previews.enabled = true;
config.previews.office.binary = '/usr/bin/soffice';
config.previews.pdftk.binary = '/usr/bin/pdftk';
config.previews.pdf2htmlEX.binary = '/usr/bin/pdf2htmlEX';
EOF
