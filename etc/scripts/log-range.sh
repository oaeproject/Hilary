#!/bin/bash

##
# Take a range of lines from the provided log file based on a grep. The output
# will be all the log lines from the first match of GREP_FROM until the last
# match of GREP_TO from the specified log file
#
# Written for MacOSX
##

GREP_FROM=$1
GREP_TO=$2
LOG_FILE=$3

function usage() {
    echo "Usage: $0 \"<grep start>\" \"<grep end>\" <log file>"
    exit 1
}

if [ -z "$GREP_FROM" ]; then
    usage;
elif [ -z "$GREP_TO" ]; then
    usage;
elif [ -z "$LOG_FILE" ]; then
    usage;
fi

START_LINE=`cat -n "$LOG_FILE" | grep "$GREP_FROM" | head -1 | awk '{print $1;}'`
END_LINE=`cat -n "$LOG_FILE" | grep "$GREP_TO" | tail -1 | awk '{print $1;}'`

cat $LOG_FILE | sed -n "$START_LINE,$END_LINE p"
