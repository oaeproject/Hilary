/*!
 * Copyright 2014 Apereo Foundation (AF) Licensed under the
 * Educational Community License, Version 2.0 (the 'License'); you may
 * not use this file except in compliance with the License. You may
 * obtain a copy of the License at
 *
 *     http://opensource.org/licenses/ECL-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an 'AS IS'
 * BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing
 * permissions and limitations under the License.
 */

var Fields = require('oae-config/lib/fields');

var widths = [
    {
        'name': '25%',
        'value': '3'
    },
    {
        'name': '33%',
        'value': '4'
    },
    {
        'name': '50%',
        'value': '6'
    },
    {
        'name': '66%',
        'value': '8'
    },
    {
        'name': '75%',
        'value': '9'
    },
    {
        'name': '100%',
        'value': '12'
    }
];

/**
 * Create a configurable landing page block with some configured default values
 *
 * @param  {Object}     [opts]                      The default values for the landing page block
 * @param  {String}     [opts.type]                 The block type. Defaults to `empty`
 * @param  {Number}     [opts.xs]                   Block width at extra small resolution. Defaults to 12
 * @param  {Number}     [opts.sm]                   Block width at small resolution. Defaults to 12
 * @param  {Number}     [opts.md]                   Block width at medium resolution. Defaults to 12
 * @param  {Number}     [opts.lg]                   Block width at large resolution. Defaults to 12
 * @param  {Number}     [opts.minHeight]            The minimum heigh in pixels
 * @param  {String}     [opts.horizontalAlign]      The horizontal alignment of the block
 * @param  {String}     [opts.verticalAlign]        The vertical alignment of the block
 * @param  {String}     [opts.bgColor]              The default background color. If left null, the block will be transparent
 * @param  {String}     [opts.titleColor]           The default title color
 * @param  {String}     [opts.textColor]            The default text color
 * @param  {String}     [opts.text]                 The default text
 * @param  {String}     [opts.icon]                 The default icon
 * @param  {String}     [opts.imgUrl]               The path to the default image URL
 * @param  {String}     [opts.videoUrl]             The path to the default video URL
 * @param  {String}     [opts.videoPlaceholder]     The path to the default video placeholder image
 * @return {Object}                                 The created landing page block
 * @api private
 */
var _createBlock = function(opts) {
    opts = opts || {};

    var type = opts.type || 'empty';
    var horizontalAlign = opts.horizontalAlign || 'center';
    var verticalAlign = opts.verticalAlign || 'middle';
    var xs = opts.xs || '12';
    var sm = opts.sm || '12';
    var md = opts.md || '12';
    var lg = opts.lg || '12';

    return {
        'name': 'Block values',
        'description': 'Block values',
        'elements': {
            'type': new Fields.List('Block type', 'Block type', type, [
                {
                    'name': 'Empty',
                    'value': 'empty'
                },
                {
                    'name': 'Search',
                    'value': 'search'
                },
                {
                    'name': 'Text',
                    'value': 'text'
                },
                {
                    'name': 'Text with icon',
                    'value': 'iconText'
                },
                {
                    'name': 'Image',
                    'value': 'image'
                },
                {
                    'name': 'Video',
                    'value': 'video'
                }
            ],  {'suppress': true}),
            'xs': new Fields.List('XS Block width', 'Block width at extra small resolution', xs, widths, {'suppress': true}),
            'sm': new Fields.List('SM Block width', 'Block width at small resolution', sm, widths, {'suppress': true}),
            'md': new Fields.List('MD Block width', 'Block width at medium resolution', md, widths, {'suppress': true}),
            'lg': new Fields.List('LG Block width', 'Block width at large resolution', lg, widths, {'suppress': true}),
            'minHeight': new Fields.Text('Block minimum height', 'Minimum height for the block in px', opts.minHeight, {'suppress': true}),
            'horizontalAlign': new Fields.List('Horizontal alignment', 'Horizontal alignment', horizontalAlign, [
                {
                    'name': 'Left',
                    'value': 'left'
                },
                {
                    'name': 'Center',
                    'value': 'center'
                },
                {
                    'name': 'Right',
                    'value': 'right'
                }
            ],  {'suppress': true}),
            'verticalAlign': new Fields.List('Vertical alignment', 'Vertical alignment', verticalAlign, [
                {
                    'name': 'Top',
                    'value': 'top'
                },
                {
                    'name': 'Middle',
                    'value': 'middle'
                },
                {
                    'name': 'Bottom',
                    'value': 'bottom'
                }
            ],  {'suppress': true}),
            'bgColor': new Fields.Text('Block background color', 'Background color for the block', opts.bgColor, {'suppress': true}),
            'titleColor': new Fields.Text('Block title color', 'Title color for the block', opts.titleColor, {'suppress': true}),
            'textColor': new Fields.Text('Block text color', 'Text color for the block', opts.textColor, {'suppress': true}),
            'text': new Fields.InternationalizableText('Block text', 'Text content for the block', opts.text, {'suppress': true}),
            'icon': new Fields.Text('Block icon', 'Icon for the block', opts.icon, {'suppress': true}),
            'imgUrl': new Fields.Text('Image URL', 'Image URL', opts.imgUrl, {'suppress': true}),
            'videoUrl': new Fields.Text('Video URL', 'Video URL', opts.videoUrl, {'suppress': true}),
            'videoPlaceholder': new Fields.Text('Video Placeholder Image', 'URL for video placeholder image', opts.videoPlaceholder, {'suppress': true})
        }
    };
};

module.exports = {
    'title': 'OAE Tenant Module',
    'block_1': _createBlock({
        'type': 'search',
        'xs': '12',
        'sm': '12',
        'md': '12',
        'lg': '12'
    }),
    'block_2': _createBlock({
        'type': 'video',
        'xs': '12',
        'sm': '12',
        'md': '8',
        'lg': '8',
        'minHeight': '290',
        'videoUrl': 'https://www.youtube.com/watch?v=cfiM87Y0pWw',
        'videoPlaceholder': '/ui/img/index-video-bg.png'
    }),
    'block_3': _createBlock({
        'type': 'text',
        'xs': '12',
        'sm': '6',
        'md': '4',
        'lg': '4',
        'titleColor': '#FFF',
        'textColor': '#FFF',
        'text': '# __MSG__SUPPORTING_ACADEMIC_COLLABORATION__\n __MSG__A_POWERFULL_NEW_WAY_FOR_STUDENTS_AND_FACULTY_TO_CREATE_KNOWLEDGE_COLLABORATE_AND_CONNECT_WITH_THE_WORLD__'
    }),
    'block_4': _createBlock({
        'type': 'iconText',
        'xs': '12',
        'sm': '6',
        'md': '4',
        'lg': '4',
        'verticalAlign': 'top',
        'bgColor': '#FFF',
        'titleColor': '#4199CA',
        'textColor': '#000',
        'text': '#### __MSG__AUTHORING_EXPERIENCE__\n __MSG__RICH_COMPELLING_INTERACTIVE_CONTENT_AUTHORING__',
        'icon': 'fa-edit'
    }),
    'block_5': _createBlock({
        'type': 'iconText',
        'xs': '12',
        'sm': '6',
        'md': '4',
        'lg': '4',
        'verticalAlign': 'top',
        'bgColor': '#424242',
        'titleColor': '#FFF',
        'textColor': '#FFF',
        'text': '#### __MSG__CHANNELS_OF_COMMUNICATION__\n __MSG__PARTICIPATING_IN_DISCUSSIONS_AND_FEEDBACK_WITHIN_PERSONALIZED_NETWORKS__',
        'icon': 'fa-comments'
    }),
    'block_6': _createBlock({
        'type': 'iconText',
        'xs': '12',
        'sm': '6',
        'md': '4',
        'lg': '4',
        'verticalAlign': 'top',
        'bgColor': '#f0EEEC',
        'titleColor': '#424242',
        'textColor': '#000',
        'text': '#### __MSG__ACCESS_TO_CONTENT__\n __MSG__EXPANDED_ACCESS_TO_LEARNING_AND_RESEARCH_MATERIALS_BETTER_CONNECTS_LIBRARY_SERVICES__',
        'icon': 'fa-cloud-download'
    }),
    'block_7': _createBlock(),
    'block_8': _createBlock(),
    'block_9': _createBlock(),
    'block_10': _createBlock(),
    'block_11': _createBlock(),
    'block_12': _createBlock()
};
