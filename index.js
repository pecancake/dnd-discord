// requires
var fs = require('fs');
var Discord = require('discord.js');
var express = require('express');
const { type } = require('os');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var lodash = require('lodash');
const { min } = require('lodash');

var host = new Discord.Client();

// express setup
app.use(express.static("./public"));

// socket setup
io.on('connection', function(socket) {
    socket.on('command', async (cmd, args) => {
        console.log(cmd, args);
        await API[cmd](...args);
    });

    socket.on('getInit', () => {
        socket.emit('init', tokens);
    });

    socket.on('getUpdate', async() => {
        pingClient("change", "Sending update packet...");
        socket.emit("update", await getUpdatePacket());
        pingClient("change", "Update Complete");
    });

    socket.on('sendChanges', async (changePacket) => {
        pingClient("change", "Received changes, updating...");
        
        var start = new Date().getTime();
        var channelChanges = {};

        for (var userID in changePacket) {
            await API.setTokens(userID, changePacket[userID]['tokens'])

            for (var i=0; i!=changePacket[userID]['channels'].length; i++) {
                var changes = changePacket[userID]['channels'][i];
                
                // create list if doesn't exist
                if (!(changes.name in channelChanges)) {
                    channelChanges[changes.name] = [];
                }
                
                // append changes
                channelChanges[changes.name].push({"userID": userID, "enabled": changes.enabled});
            }
        }
        await API.setChannels(channelChanges);
        console.log(`changes processed in ${new Date().getTime() - start} ms.`);
        pingClient("change", "Changes processed, sending update packet...");
        socket.emit("update", await getUpdatePacket());
        pingClient("change", "Update Complete");
    });

    socket.on('shellMessaging', async (payload) => {
        var shellIndex = shells.findIndex(shell => `${shell.user.username}#${shell.user.discriminator}` == payload['shell']);
        API.shellSendMessage(shellIndex, payload['channel'], payload['text']);
    })
});

// helper functions
function pingClient(event, text) {
    console.log(`pinging client: [${event}] :: ${text}`);
    io.emit("progPing", {"event": event, "text": text});
}

async function getUpdatePacket() {
    var textChannels = (await API.getGuild()).channels.cache.filter(chan => chan.type == "text" && config['channels'].includes(chan.name));
    updatePacket = {};

    // update members
    membersCache = await Promise.all(membersCache.map(async (member) => {
        pingClient("change", `Updating member data: ${member.user.username}`);
        var member = member.fetch(force=true);
        return member;
    }));

    // parse members for role data
    membersCache.forEach(async (member) => {
        updatePacket[member.id] = {};
        updatePacket[member.id]["meta"] = {};
        updatePacket[member.id]["meta"]["name"] = `${member.user.username}#${member.user.discriminator}`;
        updatePacket[member.id]["meta"]["nick"] = member.nickname;
        updatePacket[member.id]["meta"]["shell"] = (shells.find(s => s.user.id == member.id) != undefined);
        updatePacket[member.id]["tokens"] = member.roles.cache.map(role => {
            return {"type": getTokenType(role), "val": getTokenVal(role)}
        }).filter(token => token['type'] != '');
        updatePacket[member.id]["channels"] = textChannels.map(chan => {
            return {"name": chan.name, "enabled": chan.permissionsFor(member.id).has("VIEW_CHANNEL")}
        });
    });

    return updatePacket;
}

function getTokenType(role) {
    for (var type in tokens) {
        if (role.name.includes(tokens[type].find)) {
            return type;
        }
    }
    return ['@everyone', 'Admin'].includes(role.name) ? '' : role.name;
}

function getTokenVal(role) {
    var numeric = role.name.replace(/\D/g, '');
    return numeric.length > 0 ? parseInt(numeric) : undefined;
}

// config
const config = JSON.parse(fs.readFileSync('config/config.json'));

// tokens
const tokens = JSON.parse(fs.readFileSync('tokens.json'));

// secret
const secret = JSON.parse(fs.readFileSync('secret.json'));

// setup shells
var shellKeys = JSON.parse(fs.readFileSync("shells.json"));
var shells = [];
for (var i=0; i!=shellKeys.length; i++) {
    var s = new Discord.Client();
    s.login(shellKeys[i]);
    shells.push(s);
}

// API define
class API {
    static async getGuild() {
        return await host.guilds.fetch(secret.guildId);
    }

    static async init() {
        console.log("INIT STARTED");

        var roles = (await this.getGuild()).roles;
        
        // create each role
        for (var token in tokens) {
            for (var i=tokens[token].min + tokens[token].hideEmpty; i<=tokens[token].max; i++) {
                if (!roles.cache.find(role => role.name == tokens[token].template.replace("$VAL", i))) {
                    await roles.create({
                        data: {
                            name: tokens[token].template.replace("$VAL", i),
                            color: tokens[token].color
                        }
                    });
                }
            }
        }

        // setup shell pfps
        for (var s=0; s!=shells.length; s++) {
            // get shell and details
            var shell = shells[s];
            var details = config['shells'][s];
            
            // set pfps and nicknames
            shell.user.setAvatar("config/"+details['pfp']);
            await (await this.getGuild()).members.cache.find(member => member.id == shell.user.id).setNickname(details['nick']);
        }

        // setup channels
        for (var c=0; c!=config['channels'].length; c++) {
            await API.createChannel(config["channels"][c]);
        }

        console.log("INIT FINISHED");
    }

    static async teardown() {
        var roles = (await this.getGuild()).roles.cache;
        var deleteList = Object.keys(tokens).map(t => tokens[t].find)

        roles.each(async(role) => {
            if (deleteList.some(char => role.name.includes(char))){
                await role.delete();
            }
        });     
    }

    static async setChannels(channelChanges) {
        var channels = (await this.getGuild()).channels.cache.filter(chan => chan.type == "text" && config['channels'].includes(chan.name));

        for (var c in channelChanges) {
            var channel = await channels.find(chan => (chan.name == c)).fetch("true");
            var permissionOverwrites = channel.permissionOverwrites;
            var permissionCopy = JSON.parse(JSON.stringify(permissionOverwrites));

            var newPerms = channelChanges[c].map(change => {
                // if unchanged, return previous permission
                if (change.enabled == "unchanged") {
                    var old = permissionOverwrites.find(x => x.id == change.userID);

                    // if previous permission doesnt exist, create a 'VIEW_CHANNEL' permission, deny is default
                    if (old == undefined) {
                        return {"id": change.userID, 'deny': 'VIEW_CHANNEL'}; 
                    }
                    else {
                        return old
                    }
                }

                // if changes were made, return new change packet
                return {"id": change.userID, [change.enabled ? 'allow' : 'deny']: 'VIEW_CHANNEL'};
            });
            
            // process batch override
            if (!lodash.isEqual(permissionCopy, JSON.parse(JSON.stringify(newPerms)))) {
                pingClient("change", "Overwriting channel permissions...");
                await channel.overwritePermissions(newPerms);
            }
        }
    }

    static async setTokens(userID, batch) {
        // check if changes need to be done
        if (batch.every(change => change["val"] == "unchanged")) {
            return;
        }

        var member = await (await this.getGuild()).members.fetch({user:userID, force:true});

        // set up queues
        var addQueue = [];
        var removeQueue = [];

        pingClient("change", `Processing token changes for ${member.user.username}`);
        for (var i=0; i!=batch.length; i++) {
            var type = batch[i]["type"];
            var val = batch[i]["val"];

            // skip if unchanged
            if (val == "unchanged") {
                continue;
            }

            // go to create label if not token
            if (val == undefined) {
                member = await this.setLabels(userID, type);
                continue;
            }

            // delete if prompted
            if (val == "deleted") {
                var oldTokens = member.roles.cache.filter(role => role.name.includes((type in tokens) ? tokens[type].find : type));
                if (oldTokens.array().length > 0) {
                    removeQueue.push(...oldTokens.array());
                }
                continue;
            }
            
            // safety checks
            if (val < tokens[type].min || val > tokens[type].max) {
                continue;
            }

            // queue removal
            var oldTokens = member.roles.cache.filter(role => role.name.includes(tokens[type].find));
            if (oldTokens.array().length > 0) {
                removeQueue.push(...oldTokens.array());
            }
            
            // don't add if hideEmpty is true
            if (tokens[type].hideEmpty && val == 0) {
                continue
            }
            // queue adding
            var newToken = (await this.getGuild()).roles.cache.find(role => role.name == tokens[type].template.replace("$VAL", val));
            addQueue.push(newToken);
        }

        // execute queue
        if (removeQueue.length > 0 || addQueue.length > 0) {
            pingClient("change", `Forwarding token changes for ${member.user.username} to discord API`);
        }

        if (removeQueue.length > 0) {
            console.log("removing roles...");
            member = await member.roles.remove(removeQueue);
        }
        if (addQueue.length > 0) {
            console.log("adding roles...");
            member = await member.roles.add(addQueue);
        }
    }

    static async setLabels(userID, label) {
        // get member
        var member = await (await this.getGuild()).members.fetch({user:userID, force:true});

        pingClient("change", `Setting label for ${member.user.username}`);

        if (member.roles.cache.find(role => role.name == label) != undefined) {
            return;
        }

        // get role, if role exists
        var role = (await this.getGuild()).roles.cache.find(role => role.name == label);

        // create role, if role doesn't exist
        if (role == undefined) {
            var role = await (await this.getGuild()).roles.create({
                data: {
                    name: label
                }
            });       
        }

        // add role to member
        console.log("adding role...");
        member = await member.roles.add(role);

        return member
    }

    static async shellSetNickname(shellIndex, text) {
        var member = await (await this.getGuild()).members.fetch(shells[shellIndex].user.id);
        member.setNickname(text);
    }

    static async createChannel(channelName) {
        var channels = (await this.getGuild()).channels;
        if (!channels.cache.find(chan => chan.name == channelName)) {
            await channels.create(channelName, {"parent": channels.cache.find(chan => chan.name == "dnd-portal")});
        }
    }

    static async shellSendMessage(shellIndex, channelName, text) {
        var channels = (await shells[shellIndex].guilds.fetch(secret.guildId)).channels.cache.filter(chan => chan.type == "text" && config['channels'].includes(chan.name));

        var channel = channels.find(chan => chan.name == channelName);

        try {
            await channel.send(text);
        }
        catch {
            console.log(`error on shell message sending: shell ${shellIndex+1} @ ${channelName}`);
        }

    }
}

// test controller
host.on('message', async(message) => {
    if (message.content == "init") {
        if (message.author.id == secret.hostId) {
            await API.init();
        }
    }

    if (message.content.startsWith("> roll")) {
        var vals = dparse(message.content.split("> roll")[1]);
        var rollString = vals[0].map(roll => `[${roll.join(", ")}]`);
        message.channel.send(`Rolls: \`${rollString.join(" ")}\`\nTotal: \`[${vals[1]}]\``)
    }
});

// get list of members only once cause discord angry >:(
var membersCache = [];

// ready statement
host.on('ready', async () => {
    membersCache = (await (await API.getGuild()).members.fetch()).filter(m => m.id != host.user.id);    // get all members except for bot
    console.log("Ready!");
    
    // http
    http.listen(80);
});

// interactive functions
function roll(sides) {
    return Math.floor(Math.random() * (sides)) + 1;
}

function dparse(raw) {
    console.log(`"${raw}"`);
    var raw = raw.toLowerCase().replace("\\s+", "");
    console.log(raw);
    var rolls = raw.split("+");
    var results = [];
    var sum = 0;

    for (var r=0; r!=rolls.length; r++) {
        var result = [];

        console.log(rolls, r);
        if (rolls[r].includes("d")) {
            var vals = rolls[r].split("d");
            for (var n=0; n!=parseInt(vals[0]); n++) {
                result.push(roll(parseInt(vals[1])));
            }
        }
        else {
            result.push(parseInt(rolls[r]));
        }

        for (var i=0; i!=result.length; i++) {
            sum += result[i];
        }

        results.push(result);
    }

    return [results, sum];

}

// debug
host.on('debug', (info) => {
    if (info.includes("429 hit")) {
    	console.log(info);
    }
});

// login
host.login(secret.APIKey);


/*
===HIGH PRIORITY===

===LOW PRIORITY===
TODO - fix whatever it is google console is bitching about (DOM something)
*/