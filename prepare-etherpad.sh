#!/bin/sh

ETHERPAD="$(pwd)/etherpad"
TMP="$(pwd)/etherpad/tmp"
mkdir -p ${TMP}
echo ""
echo "#################################"
echo ${ETHERPAD}
echo ${TMP}

echo "Preparing to install dependencies..."
sed -i -e "93 s,grep.*,grep -E -o 'v[0-9]\.[0-9](\.[0-9])?')," ${ETHERPAD}/bin/installDeps.sh
sed -i -e '96 s,if.*,if [ "${VERSION#v}" = "$NEEDED_VERSION" ]; then,' ${ETHERPAD}/bin/installDeps.sh
${ETHERPAD}/bin/installDeps.sh

echo ""
echo "#################################"
echo "Installing ep_headings module..."
npm install --prefix ${TMP} ep_headings
mv ${TMP}/node_modules/ep_headings ${ETHERPAD}/node_modules

echo ""
echo "#################################"
echo "Installing ep_page_view module..."
npm install --prefix ${TMP} ep_page_view
mv ${TMP}/node_modules/ep_page_view ${ETHERPAD}/node_modules

echo ""
echo "#################################"
echo "Installing ep_comments module..."
cd ${ETHERPAD} && git clone https://github.com/oaeproject/ep_comments.git node_modules/ep_comments_page \
  && cd node_modules/ep_comments_page \
  && npm install

echo ""
echo "#################################"
echo "Installing ep_oae module..."
cd ${ETHERPAD}/node_modules \
  && git clone https://github.com/oaeproject/ep_oae \
  && cd ep_oae \
  && npm install

echo ""
echo "#################################"
echo "Making CSS adjustments..."
cd ${ETHERPAD} \
  && rm node_modules/ep_headings/templates/editbarButtons.ejs \
  && cp node_modules/ep_oae/static/templates/editbarButtons.ejs node_modules/ep_headings/templates/editbarButtons.ejs
cd ${ETHERPAD} \
  && rm src/static/custom/pad.css \
  && cp node_modules/ep_oae/static/css/pad.css src/static/custom/pad.css

echo ""
echo "#################################"
echo "Creating keys..."
echo "13SirapH8t3kxUh5T5aqWXhXahMzoZRA" > ${ETHERPAD}/APIKEY.txt
echo "cocoxixi" > ${ETHERPAD}/SESSIONKEY.txt
