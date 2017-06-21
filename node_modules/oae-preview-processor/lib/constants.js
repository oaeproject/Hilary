/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an "AS IS"
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */


module.exports = {
    'TYPES': {
        'IMAGE': [  'application/dicom',
                    'application/tga',
                    'application/x-font-ttf',
                    'application/x-tga',
                    'application/x-targa',
                    'image/bmp',
                    'image/gif',
                    'image/jpeg',
                    'image/jpg',
                    'image/png',
                    'image/targa',
                    'image/tga',
                    'image/tiff',
                    'image/vnd.adobe.photoshop',
                    'image/x-cmu-raster',
                    'image/x-gnuplot',
                    'image/x-icon',
                    'image/x-targa',
                    'image/x-tga',
                    'image/x-xbitmap',
                    'image/x-xpixmap',
                    'image/x-xwindowdump',
                    'image/xcf'
                 ],
        'OFFICE': [ 'application/msword',
                    'application/rdf+xml',
                    'application/vnd.ms-excel',
                    'application/vnd.ms-powerpoint',
                    'application/vnd.oasis.opendocument.presentation',
                    'application/vnd.oasis.opendocument.spreadsheet',
                    'application/vnd.oasis.opendocument.text',
                    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    'application/x-mspowerpoint',
                    'application/x-pdf',
                    'application/x-powerpoint',
                    'text/plain'
                  ],
        'PDF': [
            'application/pdf'
        ],
        'VIDEO': [
            'application/annodex',
            'application/gsm',
            'application/gxf',
            'application/mxf',
            'application/ogg',
            'application/x-gsm',
            'application/x-troff-msvideo',
            'application/x-winamp',
            'video/3gpp',
            'video/3gpp2',
            'video/annodex',
            'video/avi',
            'video/avs-video',
            'video/cdg',
            'video/lml',
            'video/mp1s',
            'video/mp2p',
            'video/mp2t',
            'video/mp4',
            'video/mpeg',
            'video/msvideo',
            'video/ogg',
            'video/quicktime',
            'video/vnd.rn-realvideo',
            'video/webm',
            'video/x-dv',
            'video/x-f4v',
            'video/x-fli',
            'video/x-flv',
            'video/x-m4v',
            'video/x-matroska',
            'video/x-ms-asf',
            'video/x-ms-wmv',
            'video/x-msvideo',
            'video/x-mve',
            'video/x-pva'
        ],
        'AUDIO': [
            'audio/3gpp',
            'audio/3gpp2',
            'audio/aac',
            'audio/aacp',
            'audio/ac3',
            'audio/aiff',
            'audio/amr',
            'audio/annodex',
            'audio/basic',
            'audio/flac',
            'audio/gsm',
            'audio/L16',
            'audio/L20',
            'audio/L24',
            'audio/L8',
            'audio/mid',
            'audio/mp3',
            'audio/mp4',
            'audio/MP4A-LATM',
            'audio/mpa',
            'audio/mpeg',
            'audio/mpeg4-generic',
            'audio/musepack',
            'audio/ogg',
            'audio/qcelp',
            'audio/vnd.rn-realaudio',
            'audio/vnd.wav',
            'audio/vorbis',
            'audio/wav',
            'audio/webm',
            'audio/x-aiff',
            'audio/x-ape',
            'audio/x-caf',
            'audio/x-gsm',
            'audio/x-matroska',
            'audio/x-ms-wma',
            'audio/x-musepack',
            'audio/x-pn-realaudio',
            'audio/x-pn-realaudio-plugin',
            'audio/x-twinvq',
            'audio/x-twinvq-plugin',
            'audio/x-wavpack'
        ],
        'DEFAULT': 'application/octet-stream'
    },
    'MQ': {
        'TASK_GENERATE_PREVIEWS': 'oae-preview-processor/generatePreviews',
        'TASK_GENERATE_FOLDER_PREVIEWS': 'oae-preview-processor/generateFolderPreviews',
        'TASK_REGENERATE_PREVIEWS': 'oae-preview-processor/regeneratePreviews'
    },
    'SIZES': {
        'IMAGE': {
            'SMALL': 348,
            'MEDIUM': 1400,
            'LARGE': 2000,
            'THUMBNAIL': 324,
            'WIDE_WIDTH': 1070,
            'WIDE_HEIGHT': 500
        },
        'PDF': {
            'SMALL': 360,
            'NORMAL': 700, // We can't use medium here as the documentviewer requires 'normal' as part of the filename.
            'LARGE': 2000
        }
    },
    'EVENTS': {
        'PREVIEWS_FINISHED': 'previews-finished'
    },
    'FORBIDDEN': {
        'INTERNAL_IPS': [
            '10.0.0.0/8',
            '192.168.0.0/16',
            '172.16.0.0/12',
            '100.64.0.0/10',
            '192.0.2.0/24',
            '198.51.100.0/24',
            '203.0.113.0/24',
            '198.18.0.0/15',
            '127.0.0.0/8',
            'fd00::/8'
        ]
    }
};
