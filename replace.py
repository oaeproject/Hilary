#!/usr/bin/python

import re
import sys

#_$jscoverage['cassandra.js'][21] = 0;

def repl(matchobj):
    return "_$jscoverage['%s/%s']" % (sys.argv[2], matchobj.group(1));

#lines = open(sys.argv[1], 'r').readlines()
#for line in lines:
#    a = re.sub("_\$jscoverage\['(.*)'\]", repl, line);
#    print a.rstrip()

text_file = open(sys.argv[1], "r+")
whole_thing = text_file.read()
whole_thing = re.sub("_\$jscoverage\['(.*)'\]", repl, whole_thing);
text_file.seek(0);
text_file.write(whole_thing);
text_file.close();