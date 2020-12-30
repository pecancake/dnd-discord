function test(cmd, args) {
    socket.emit('command', cmd, args);
}

function sendChanges() {
    document.getElementById("serverProgress").innerText = "Sending changes to server...";
    changePacket = pullChanges();
    console.log("changes: ", changePacket);
    socket.emit("sendChanges", changePacket);
}

function createController(userName, userNick, userId, toks, channels, isShell) {
    var htmlTemplate = `
    <div class="col bord" id="userController" data-user-name=${userName} data-user-id=${userId} style="max-width:350px;min-width:350px;justify-content:start;margin:10px;border-width:4px${isShell ? ";border-color:#7289DA" : ""}">
        <div class="bord" id="title">${userNick || userName}</div>
        <div class="row" id="controls">
            <div class="bord col" style="width:60%;justify-content:start">
                <div class="row" id="mainButtons">
                    <div style="width:80%">
                        <input id="roleInput" placeholder="role" style="width:65%">
                        <button onclick="addTempToken(this)" style="width:35%">ADD</button>
                    </div>
                    <button id="delToggle" onclick="delToggle(this)" data-del-toggled="false">DEL</button>
                </div>
                <div class="col" id="tokens">
                    ${createTokens(toks)}
                </div>
            </div>
            <div id="channels" class="bord col" style="width:40%;justify-content:start">
                ${createChannels(channels)}
            </div>
        </div>
    </div>`;

    // convert template to object, add to document
    var controller = createElement(htmlTemplate);
    document.getElementById("userControllers").appendChild(controller);
}

function createElement(htmlTemplate) {
    var temp = document.createElement("div");
    temp.innerHTML = htmlTemplate.trim();
    return temp.firstChild;
}

function pullChanges() {
    var controllers = document.getElementById("userControllers");
    var rtn = {};

    for (var c=0; c!=controllers.children.length; c++) {
        var control = controllers.children[c];
        rtn[control.getAttribute("data-user-id")] = pullController(control);
    }

    return rtn;
}

function pullController(controller) {
    function pullToken(token) {
        // get value element
        var val = token.querySelector("#tokenValue");

        // fill value element in dictionary
        var rtn = {"type": token.querySelector("#tokenType").innerText};
        
        // if not label, add value
        if (token.getAttribute("data-isLabel") == "false") {
            // get data from non-label token
            var trueVal = parseInt(val.getAttribute("data-true"));

            // set data value
            if (val.value == trueVal && token.getAttribute("data-isTemp") == "false") {
                rtn["val"] = "unchanged";
            }
            else {
                rtn["val"] = parseInt(val.value);
            }
        }
        else {
            if (token.getAttribute("data-isTemp") == "false") {
                rtn["val"] = "unchanged";
            } 
        }

        if (token.getAttribute("data-isDel") == "true") {
            rtn["val"] = "deleted";
        }

        // return changes
        return rtn;
    }

    function pullChannel(channel) {
        // get data
        var val = channel.getAttribute("data-enabled");
        var trueVal = channel.getAttribute("data-true");

        // return changes
        return {
            "name": channel.innerText,
            "enabled": ((val == trueVal) ? "unchanged" : (val == "true"))
        }
    }

    var userID = controller.getAttribute("data-user-id");
    var rtn = {"tokens": [], "channels": []};

    // pull token changes
    var tokensElem = controller.querySelector("#tokens");
    for (var z=0; z!=tokensElem.children.length; z++) {
        var token = tokensElem.children[z];
        var result = pullToken(token);

        if (result) {
            rtn["tokens"].push(result);
        }
    }

    // pull channel changes
    var channelsElem = controller.querySelector("#channels");
    for (var z=0; z!=channelsElem.children.length; z++) {
        var channel = channelsElem.children[z];
        var result = pullChannel(channel);

        if (result) {
            rtn["channels"].push(result);
        }
    }

    // output
    return rtn;
}

function tokenUpdateTrueVal(elem) {
    // get trueValElem
    var trueValElem = elem.querySelector("#trueVal");
    
    // get data from token
    var target = elem.querySelector("#tokenValue");
    var trueVal = parseInt(target.getAttribute("data-true"));

    // update if needed
    if (trueVal != target.value) {
        trueValElem.innerText = `(${trueVal})`;
    }
    else {
        trueValElem.innerText = '';
    }
}

function sanitizeTokenInput(elem) {
    var val = parseInt(elem.value);
    var min_ = parseInt(elem.getAttribute("data-min"));
    var max_ = parseInt(elem.getAttribute("data-max"));

    var newVal = clamp(val, min_, max_);

    return newVal;
    
}

function clamp(i, min_, max_) {
    return Math.max(min_, Math.min(i, max_));
}

function tokenInc(elem, inc) {
    // find input element
    var token = elem.parentNode.parentNode;
    var target = token.querySelector("#tokenValue");

    // extract data and add
    var val = parseInt(target.value);
    val += inc;

    // update element input
    target.value = val.toString();
    
    // sanitize input
    target.value = sanitizeTokenInput(target);

    // update element true val
    tokenUpdateTrueVal(token);
}
function createToken({type, val=null, temp=false}) {
    var min, max;
    if (type in tokens) {
        min = tokens[type]['min'];
        max = tokens[type]['max'];
    }

    return `
        <div class="col" id="token" style="height:70px" data-isTemp=${temp} data-isDel="false" data-isLabel=${val===null ? "true" : "false"}>
            <div class="row bord" style="height:60%;justify-content:start${temp ? ";background-color:#cac9ff" : ""}">
                <div id="tokenType" style="justify-content:start;align-items:center;width:65%">${type}</div>
                ${val===null ? "" : `
                <div class="row" style="width:35%">
                    <input onclick="this.select()" oninput="tokenUpdateTrueVal(this.parentNode)" onfocusout="this.value = sanitizeTokenInput(this)" id="tokenValue" value=${val} style="width:60%;background-color:inherit" data-min="${min}" data-max="${max}" data-true="${val}">
                    <div class="col" style="width:40%">
                        <div id="trueVal" style="font-size:small"></div>
                        <div style="font-size:small">/${max}</div>
                    </div>
                </div>`}
            </div>
            <div id="incButtons" class="row" style="height:40%">
            ${val===null ? "" : `
                <button style="width:50%" onclick="tokenInc(this, 1)"> + </button>
                <button style="width:50%" onclick="tokenInc(this, -1)"> - </button>
            `}
            </div>
            <div id="delButton" style="height:40%;display:none">
                <button onclick="toggleDelToken(this)">Delete Token</button>
            </div>
        </div>`;
}

function toggleDelToken(elem) {
    token = elem.parentNode.parentNode;
    token.setAttribute("data-isDel", !(token.getAttribute("data-isDel") == "true"));

    // set input color to red if isDel
    token.children[0].style.backgroundColor = ((token.getAttribute("data-isDel") == "true") ? "#ffc9c9" : "inherit");

    // delete if temp
    if (token.getAttribute("data-isTemp") == "true" && token.getAttribute("data-isDel") == "true") {
        token.parentNode.removeChild(token);
    }
}

function createTokens(toks) {
    var htmlTemplate = '';
    
    toks.sort((i, k) => i.type.localeCompare(k.type));

    // create tokens and add to html template
    for (var i=0; i!=toks.length; i++) {
        var t = toks[i];
        htmlTemplate += createToken({type:t['type'], val:t['val']});
    }

    return htmlTemplate;
}

function toggleChannel(elem) {
    // get data
    var isEnabled = (elem.getAttribute("data-enabled") == "true");

    // toggle data
    elem.setAttribute("data-enabled", !isEnabled);

    // update graphics
    if (!isEnabled) {
        elem.style.backgroundColor = "#ade0b4";
    }
    else {
        elem.style.backgroundColor = "#e0adad";
    }
}

function createChannels(channels) {
    var htmlTemplate = '';

    for (var i=0; i!=channels.length; i++) {
        var bord = `border: 5px ${channels[i]['enabled'] ? "#8db893" : "#b58a8a"} solid`;
        var bgCol = `background-color: ${channels[i]['enabled'] ? "#ade0b4" : "#e0adad"}`;
        htmlTemplate += `
        <button style="height:40px;${bgCol};margin:1px;${bord}" onclick="toggleChannel(this)" data-enabled=${channels[i]['enabled']} data-true=${channels[i]['enabled']}>${channels[i]['name']}</button>
        `;
    }
    
    return htmlTemplate;
}

function addTempToken(elem) {
    // find tokens element
    var controls = elem.parentNode.parentNode.parentNode;
    var input = controls.querySelector("#roleInput");
    var target = controls.querySelector("#tokens");

    // create element
    var t = input.value;
    var token;

    console.log(t, tokens);

    if (t == "") {
        return;
    }
    
    if (t in tokens) {
        token = createToken({type:t, val:tokens[t]['max'], temp:true});
    }
    else {
        token = createToken({type:t, temp:true});
    }

    // reset input value
    input.value = "";

    // reset token del states
    setTokenDelStates(elem.parentNode.parentNode.parentNode.parentNode, false);

    for (var child=0; child!=target.children.length; child++) {
        console.log(target.children[child].querySelector("#tokenType").innerText, t, target.children[child].querySelector("#tokenType").innerText.localeCompare(t));
        if (target.children[child].querySelector("#tokenType").innerText.localeCompare(t) == 1) {
            target.insertBefore(createElement(token), target.children[child]);
            return;
        }
    }
    target.appendChild(createElement(token));
}

function delToggle(elem) {
    // get data
    var toggled = (elem.getAttribute("data-del-toggled") == "true");

    // update tokens (passing in controls element)
    setTokenDelStates(elem.parentNode.parentNode.parentNode, !toggled);
}

function setTokenDelStates(controller, state) {
    var toks = [...controller.querySelector("#tokens").children];
    toks.forEach(child => {
        child.querySelector("#incButtons").style.display = state ? "none" : "flex";
        child.querySelector("#delButton").style.display = state ? "flex": "none";
    });

    var delToggle = controller.querySelector("#delToggle");
    delToggle.setAttribute("data-del-toggled", state);

    delToggle.style.backgroundColor = ((delToggle.getAttribute("data-del-toggled") == "true") ? "rgb(252, 220, 131)" : "")   
}

function updateShellMessaging() {
    var sm = document.getElementById("shellMessaging");

    // clear shell options, then add updated version
    var shellSelect = sm.querySelector("#shell");
    shellSelect.innerHTML = "";
    for (var i=0; i!=shellData.length; i++) {
        var elem = createElement(`<option value=${shellData[i]['meta']['name']}>${shellData[i]['meta']['nick']}</option>)`)
        shellSelect.appendChild(elem);
    }    

    // update once
    updateShellMessagingChannels();
}

function updateShellMessagingChannels() {
    var sm = document.getElementById("shellMessaging");

    // clear shell channel options, then add updated version
    var shellChoice = sm.querySelector("#shell").value;
    var channelSelect = sm.querySelector("#channel");
    channelSelect.innerHTML = "";
    for (var i=0; i!=shellData.length; i++) {
        if (shellData[i]['meta']['name'] == shellChoice) {
            // if theres a match, add all channels to select element
            for (var c=0; c!=shellData[i]['channels'].length; c++) {
                var chan = shellData[i]['channels'][c];
                var elem = chan['enabled'] ? createElement(`<option>${chan['name']}</option>`) : "";

                // add option if enabled
                if (elem != "") {
                    channelSelect.appendChild(elem);
                }
            }
            break;
        }
    }
}

function shellMessagingSend() {
    var sm = document.getElementById("shellMessaging");

    // get values
    var shellChoice = sm.querySelector("#shell").value;
    var chanChoice = sm.querySelector("#channel").value;
    var text = sm.querySelector("#message").value;

    // reset value
    sm.querySelector("#message").value = "";

    // construct package
    var payload = {
        "shell": shellChoice,
        "channel": chanChoice,
        "text": text
    }

    // send package
    socket.emit("shellMessaging", payload);
}

// init tokens variable
var tokens;
var shellData = [];

socket.on('init', (tok) => {
    tokens = tok;
    socket.emit("getUpdate");
});

socket.on('update', (updatePacket) => {
    console.log(updatePacket, tokens);

    // clear UserControllers and shellData
    document.getElementById("userControllers").innerHTML = "";
    shellData = [];

    for (var userID in updatePacket) {       
        // create userController
        createController(updatePacket[userID]['meta']['name'], updatePacket[userID]['meta']['nick'], userID, updatePacket[userID]['tokens'], updatePacket[userID]['channels'], updatePacket[userID]['meta']['shell']);

        // format shellData
        if (updatePacket[userID]['meta']['shell']) {
            shellData.push(updatePacket[userID]);
        }
    } 
    console.log(shellData);
    updateShellMessaging();
});

socket.on("progPing", (pingPacket) => {
    console.log(pingPacket);
    if (pingPacket.event == "change") {
        document.getElementById("serverProgress").innerText = pingPacket.text;
    }
});

socket.emit("getInit");

// keybind organizer
var keysPressed = [];

window.addEventListener('keydown', (event) => {
    if (!keysPressed.includes(event.key)) {
        keysPressed.push(event.key);
    }
});

window.addEventListener('keyup', (event) => {
    keysPressed = keysPressed.filter((key) => key != event.key);

    if (event.key == "Enter" && !keysPressed.includes("Shift") && document.activeElement == document.getElementById("message")) {
        shellMessagingSend();
    }
});