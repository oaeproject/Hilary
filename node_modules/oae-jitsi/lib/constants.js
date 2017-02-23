var MeetingsConstants = module.exports.MeetingsConstants = {};

MeetingsConstants.roles = {
    // Determines not only all known roles, but the ordered priority they take as the "effective" role. (e.g., if
    // you are both a member and a manager, your effective role is "manager", so it must be later in the list)
    'ALL_PRIORITY': ['member', 'manager'],

    'MANAGER': 'manager',
    'MEMBER': 'member'
};

MeetingsConstants.events = {
    'CREATED_MEETING': 'createdMeeting',
    'GET_MEETING_PROFILE': 'getMeetingProfile',
    'UPDATED_MEETING': 'updatedMeeting',
    'DELETED_MEETING': 'deletedMeeting',
    'UPDATED_MEETING_MEMBERS': 'updatedMeetingMembers',
    'CREATED_MEETING_MESSAGE': 'createdMeetingMessage',
    'DELETED_MEETING_MESSAGE': 'deletedMeetingMessage',
    'GET_MEETING_LIBRARY': 'getMeetingLibrary'
};

MeetingsConstants.activity = {
    'ACTIVITY_MEETING_CREATE': 'meeting-jitsi-create',
    'ACTIVITY_MEETING_SHARE': 'meeting-jitsi-share',
    'ACTIVITY_MEETING_UPDATE': 'meeting-jitsi-update',
    'ACTIVITY_MEETING_UPDATE_VISIBILITY': 'meeting-jitsi-update-visibility',
    'ACTIVITY_MEETING_ADD_TO_LIBRARY': 'meeting-jitsi-add-to-library',
    'ACTIVITY_MEETING_UPDATE_MEMBER_ROLE': 'meeting-jitsi-update-member-role',
    'ACTIVITY_MEETING_MESSAGE': 'meeting-jitsi-message'
};

MeetingsConstants.updateFields = [
    'displayName',
    'description',
    'chat',
    'contactList',
    'visibility'
];

MeetingsConstants.library = {
    'MEETINGS_LIBRARY_INDEX_NAME': 'meetings-jitsi:meetings-jitsi'
};

MeetingsConstants.search = {
    'MAPPING_MEETING_MESSAGE': 'meeting-jitsi_message'
};

