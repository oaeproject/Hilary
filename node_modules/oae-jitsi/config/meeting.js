var Fields = require('oae-config/lib/fields');

module.exports = {
    'title': 'OAE Jitsi Module',
    'visibility': {
        'name': 'Default Visibility Value',
        'description': 'Default visibility setting for new meeting',
        'elements': {
            'meeting': new Fields.List('Meetings Visibility', 'Default visibility for a new meeting', 'public', [
                {
                    'name': 'Public',
                    'value': 'public'
                },
                {
                    'name': 'Logged in users',
                    'value': 'loggedin'
                },
                {
                    'name': 'Private',
                    'value': 'private'
                }
            ])
        }
    },
    'server': {
        'name': 'Jitsi Configuration',
        'description': 'Core Configuration',
        'elements': {
            'host': new Fields.Text('Jitsi server address', 'Jitsi server address', 'https://meet.jit.si/'),
        }
    }
};