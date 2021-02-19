#!/bin/sh

# Include these steps if running locally
# They have been included on CircleCI already
# cp ep-settings.json etherpad/settings.json
# cp ep-package.json etherpad/src/package.json

BASE_DIR="$(pwd)"
ETHERPAD="$(pwd)/etherpad"
ETHERPAD_MODULES="${ETHERPAD}/node_modules"

echo ""
echo "###"
echo "### Step 1: set up vars"
echo "###"
echo "Etherpad path: ${ETHERPAD}"
echo ""

echo ""
echo "###"
echo "### Step 2: Preparing to install dependencies..."
echo "###"
sed -i -e "93 s,grep.*,grep -E -o 'v[0-9]\.[0-9](\.[0-9])?')," ${ETHERPAD}/bin/installDeps.sh
sed -i -e '96 s,if.*,if [ "${VERSION#v}" = "$NEEDED_VERSION" ]; then,' ${ETHERPAD}/bin/installDeps.sh
${ETHERPAD}/bin/installDeps.sh
echo ""

echo ""
echo "###"
echo "### Step 3: Installing ep_headings module..."
echo "###"
cd ${ETHERPAD} && npm install ep_headings
rm package-lock.json
cd ${BASE_DIR}
echo ""

echo ""
echo "###"
echo "### Step 4: Installing ep_page_view module..."
echo "###"
cd ${ETHERPAD} && npm install ep_page_view@0.5.24
rm package-lock.json
cd ${BASE_DIR}
echo ""

echo ""
echo "###"
echo "### Step 5: Installing ep_comments module..."
echo "###"
echo "$(pwd)"
git clone https://github.com/oaeproject/ep_comments ${ETHERPAD_MODULES}/ep_comments_page \
  && cd ${ETHERPAD_MODULES}/ep_comments_page \
  && npm install
cd ${BASE_DIR}
echo ""

echo ""
echo "###"
echo "### Step 6: Installing ep_oae module..."
echo "###"
git clone https://github.com/oaeproject/ep_oae ${ETHERPAD_MODULES}/ep_oae \
  && cd ${ETHERPAD_MODULES}/ep_oae \
  && npm install
cd ${BASE_DIR}
echo ""

echo ""
echo "###"
echo "### Step 7: Making CSS adjustments..."
echo "###"
cd ${ETHERPAD} \
  && rm node_modules/ep_headings/templates/editbarButtons.ejs \
  && cp node_modules/ep_oae/static/templates/editbarButtons.ejs node_modules/ep_headings/templates/editbarButtons.ejs
cd ${ETHERPAD} \
  && rm src/static/custom/pad.css \
  && cp node_modules/ep_oae/static/css/pad.css src/static/custom/pad.css
cd ${BASE_DIR}
echo ""

echo ""
echo "#################################"
echo "Creating keys..."
echo "13SirapH8t3kxUh5T5aqWXhXahMzoZRA" > ${ETHERPAD}/APIKEY.txt
echo "cocoxixi" > ${ETHERPAD}/SESSIONKEY.txt
