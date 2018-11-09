The `library` module for OAE.

A generic module which handles indexing libraries.
A "Library" is essentially a sorted list of resource ids in which a visibility mask is applied. You effectively get 3 different sub-lists: private, loggedin, public, and the authentication+tenant of the user accessing the library determines which version of the Library you get.