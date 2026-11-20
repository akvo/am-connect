# AMConnect

One service for ASEAN minerals information, maps, cooperation material and investment
engagement, with one shared sign-in.

## Applications

**Platform**:
The Landing Page, CMS and WebGIS, including custom maps built from accessible datasets.

**Data Service**:
CKAN for datasets and resources, with GeoServer and PostGIS behind it.
_Avoid_: CKAN (when the whole service is meant)

**AOCP**:
The cooperation workspace where delegated ASEAN and Member State representatives share
documents and track AMCAP implementation.

**AMVest**:
The external investment-promotion and forum platform, run by another ASEAN partner.
_Avoid_: AMVest Forum (as a separate thing)

## People and access

**Super Admin**:
The person who administers AMConnect across all applications and countries.
_Avoid_: Platform Super Admin, admin

**ASEC**:
An ASEAN Secretariat user who manages ASEC and AOCP users and resources across all
countries.

**AOCP country user**:
A user who manages AOCP users and resources within their assigned country only.
_Avoid_: AOCP user, country user

**AMVest Admin**:
A user who manages AMVest forum users and moderates posts; grants nothing on the Platform
or Data Service.

**AMVest user**:
A registered forum participant; every activated account is one.
_Avoid_: Registered AMVest user, public user

**Anonymous visitor**:
Someone who views approved public pages, maps and forum content without signing in.

**Country scope**:
The Member States assigned to an AOCP country user, which bound what they may manage.
_Avoid_: country label

**Member State**:
One of the eleven ASEAN countries.
_Avoid_: member country
