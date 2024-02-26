# Technical background on map handling

## Read available maps
In the new CS2 dedicated server, there is no single function to list all maps available.
The internal maps are accessible as before with the ```maps *``` command. However there are lots of entries in the answer that are not real maps.
Workshop maps from a hosted collection are available by calling ```ds_workshop_listmaps```. This only lists the filenames of the maps and no workshop id. Unfortunately, the filenames are not available in the stamAPI, so there is currently no way to match the output fo ```ds_workshop_listmaps``` to preview pictures from the steamAPI.
For the Official maps the filenames are available in the API.

Therefore I decided to work with a static list for the official maps and get the workshop maps of a collection directly via the steamAPI.

```ds_workshop_listmaps``` is only a backup in case the API is not reachable for some reason.

## Change maps
To change a map, there are also different commands whether it's a built in or a workshop map.

- ```map <mapfilename>``` is used to change level to a built in map.
- ```ds_workshop_changelevel <mapfilename>``` is used to change level to a map present in the hosted workshop collection.
- ```host_workshop_map``` ist used to change to any workshop map.

This cs2-api takes either the map-filename, the workshop-id or the title from the workshop details and matches it to a map-details object. Depending if it's an official of a workshop map, the respective command is called. If the workshop-id is not available for a workshop map, ```ds_workshop_changelevel``` is used.

For that reason, a workshop collection id has to be set in the config if workshop maps are to be used.

Alternatively one could call ```host_workshop_map``` via rcon command using the ```/rcon``` endpoint.