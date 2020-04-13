#!/bin/sh

ETHERPAD="/Users/miguel/Work/Hilary/etherpad"
echo ${ETHERPAD}

echo "Preparing to install dependencies..."
cd ${ETHERPAD}
sed -i -e "93 s,grep.*,grep -E -o 'v[0-9]\.[0-9](\.[0-9])?')," ${ETHERPAD}/bin/installDeps.sh
sed -i -e '96 s,if.*,if [ "${VERSION#v}" = "$NEEDED_VERSION" ]; then,' ${ETHERPAD}/bin/installDeps.sh
${ETHERPAD}/bin/installDeps.sh

echo "Installing ep_headings module..."
cd ${ETHERPAD}
npm install ep_headings

echo "Installing ep_page_view module..."
cd ${ETHERPAD}
npm install ep_page_view

echo "Installing ep_comments module..."
git clone https://github.com/oaeproject/ep_comments.git node_modules/ep_comments_page \
  && cd node_modules/ep_comments_page \
  && npm install

cd ${ETHERPAD}
echo "Installing ep_oae module..."
cd node_modules \
  && git clone https://github.com/oaeproject/ep_oae \
  && cd ep_oae \
  && npm install

cd ${ETHERPAD}
echo "Making CSS adjustments..."
rm node_modules/ep_headings/templates/editbarButtons.ejs && cp node_modules/ep_oae/static/templates/editbarButtons.ejs node_modules/ep_headings/templates/editbarButtons.ejs
rm src/static/custom/pad.css && cp node_modules/ep_oae/static/css/pad.css src/static/custom/pad.css

echo "Creating keys..."
echo "13SirapH8t3kxUh5T5aqWXhXahMzoZRA" > APIKEY.txt
echo "cocoxixi" > SESSIONKEY.txt
