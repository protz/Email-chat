/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Thunderbird Conversations
 *
 * The Initial Developer of the Original Code is
 *  Jonathan Protzenko <jonathan.protzenko@gmail.com>
 * Portions created by the Initial Developer are Copyright (C) 2010
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

"use strict";

const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource:///modules/gloda/gloda.js");
Cu.import("resource:///modules/templateUtils.js"); // for makeFriendlyDateAgo
Cu.import("resource://emailchat/stdlib/msgHdrUtils.js");
Cu.import("resource://emailchat/stdlib/misc.js");
Cu.import("resource://emailchat/stdlib/compose.js");
Cu.import("resource://emailchat/stdlib/send.js");
Cu.import("resource://emailchat/log.js");

let Log = setupLogging("EmailChat.UI");

const gHeaderParser = Cc["@mozilla.org/messenger/headerparser;1"]
                      .getService(Ci.nsIMsgHeaderParser);

const kSigRegExp = /-- \n((\s|.)*)+/m;

$(document).ready(function($) {
  // size elements
  $(window).bind("load resize", function() {
    let h = $(window).height();
    let w = $(window).width();
    $("li.messageTo, li.messageFrom").css({ "width" : w-84 });
  });   
}); 

// Global GC root preventing the query from being collected.
var gChat = null;

function Chat (aMsg) {
  this.msgHdr = aMsg;
  this.query = null;
  this.conversation = null;
  this.seen = {};
  this.lastMsgHdr = null;
}

Chat.prototype = {
  /**
   * This function runs the initial query, obtains a GlodaMessage corresponding
   * to the message that was originally selected in the message list, and then
   * takes the underlying GlodaConversation object and obtains the correpsonding
   * message collection.
   *
   * The listener that's reponsible for doing stuff with the conversation
   * messages is Chat.prototype. We have an intermediate listener inside the
   * load function.
   */
  load: function () {
    Log.debug("Loading", this.msgHdr);
    let self = this;
    Gloda.getMessageCollectionForHeaders([this.msgHdr], {
      onItemsAdded: function (aItems) {
        if (aItems.length) {
          // So this is the important part. GC collects objects that are not
          // referenced by anyone anymore. So we must make sure someone is still
          // referencing our Gloda query, otherwise the GC will collect it and
          // we won't be notified about newly arrived messages.
          //
          // The gChat object will never be collected, and through the gChat
          // object, there is a reference to the Gloda, so we should not worry
          // about that.
          self.query = aItems[0].conversation.getMessagesCollection(self, true);
          self.conversation = aItems[0].conversation;
        } else {
          Log.error("Gloda query returned no messages.");
        }
      },
      onItemsModified: function () {},
      onItemsRemoved: function () {},
      onQueryCompleted: function (aCollection) {},
    }, null);
  },

  // This is the part that makes us behave like a gloda listener.
  onItemsAdded: function (aItems) {
    // We use onItemsAdded so that if messages are added later on (i.e. because
    //  we replied to the thread, for instance), we're notified too...
    // Conversely, onQueryCompleted is only called once, when the initial batch
    //  of messages has been fetched.
    this.output(aItems);
  },
  onItemsModified: function () {},
  onItemsRemoved: function () {},
  onQueryCompleted: function (aCollection) {},

  /**
   * This function is called when we receive new messages in the conversation.
   * This can be either the initial batch of messages, or newly arrived messages
   * in the conversation.
   *
   * It runs the jquery-tmpl template and then appends the result to the root
   * DOM node.
   */
  output: function (aGlodaMessages) {
    // Create the template data. This is the chunks variable, and it has this
    // shape:
    //  [{ name, email, fromMe, items: [{ text, date }] }]
    let chunks = [];
    for each (let [i, glodaMsg] in Iterator(aGlodaMessages)) {
      // First, don't add to the chat view a message we've already seen.
      if (glodaMsg.headerMessageID in this.seen)
        continue;
      this.seen[glodaMsg.headerMessageID] = null;

      // glodaMsg: GlodaMessage
      // glodaMsg.from: GlodaIdentity
      // glodaMsg.from.contact: GlodaContact
      let email = glodaMsg.from.value;
      let name = glodaMsg.from.contact.name;
      let fromMe = (email in gIdentities);
      //Log.debug(email, name, fromMe);
      let lastChunk = chunks[chunks.length - 1];
      // Shall we create a new "message block"? Yes if it's the first one, or if
      //  the participant changed.
      if (i == 0 || lastChunk.email != email) {
        chunks.push({
          name: name,
          email: email,
          clazz: fromMe ? "From" : "To",
          items: [],
        });
        lastChunk = chunks[chunks.length - 1];
      }

      let body = glodaMsg._indexedBodyText.replace(kSigRegExp, "");
      let data = {
        body: body,
        date: makeFriendlyDateAgo(new Date(glodaMsg.date)),
      };
      lastChunk.items.push(data);

      if (glodaMsg.folderMessage)
        this.lastMsgHdr = glodaMsg.folderMessage;
    }

    // Output the data
    $("#messageTemplate").tmpl(chunks).appendTo($("#conversation"));
    $("#subjectText").text(this.conversation._subject);
    // This will also update the tab title
    document.title = this.conversation._subject;
  },

};

$(document).ready(function () {
  // Parse URL components
  let param = "?uri="; // only one param
  let url = document.location.href;
  let uri = url.substr(url.indexOf(param) + param.length, url.length);

  // Create the Chat object.
  let msgHdr = msgUriToMsgHdr(uri);
  gChat = new Chat(msgHdr);
  gChat.load();
});

function onSend () {
  // This gets us a reference to the main window
  let w = getMail3Pane();
  let msgHdr = gChat.lastMsgHdr;
  // Which has that very convenient function called getIdentityForHeader
  let identity = w.getIdentityForHeader(msgHdr, Ci.nsIMsgCompType.ReplyAll)
    || gIdentities.default;
  // Thunderbird-stdlib does the messy job of determining the compose
  //  parameters for us
  let { to, cc, bcc } = replyAllParams(identity, msgHdr);
  // mime2DecodedSubject already strips any RE:, Re: part
  let subject = "Re: " + msgHdr.mime2DecodedSubject;

  // See the documentation for that big function's parameters. It will
  //  automatically query the textarea (passed as $("#mailBody")[0]) for the
  //  message text.
  sendMessage({
    msgHdr: msgHdr,
    identity: identity,
    to: [gHeaderParser.makeFullAddress(name, email) for each ([name, email] in to)],
    cc: [gHeaderParser.makeFullAddress(name, email) for each ([name, email] in cc)],
    bcc: [gHeaderParser.makeFullAddress(name, email) for each ([name, email] in bcc)],
    subject: subject,
  }, {
    compType: Ci.nsIMsgCompType.ReplyAll,
    deliverType: Ci.nsIMsgCompDeliverMode.Now,
  }, $("#mailBody")[0], {
    progressListener: null,
    sendListener: null,
    stateListener: {
      NotifyComposeFieldsReady: function() { },
      NotifyComposeBodyReady: function() { },
      SaveInFolderDone: function(folderURI) { },

      ComposeProcessDone: function(aResult) {
        if (NS_SUCCEEDED(aResult))
          $("#mailBody").val("... message sent.");
      },
    },
  });
}
