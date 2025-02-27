/**
 * Represents the status of a message
 */
export var MessageStatus;
(function (MessageStatus) {
  MessageStatus["SENDING"] = "sending";
  MessageStatus["SENT"] = "sent";
  MessageStatus["ERROR"] = "error";
})(MessageStatus || (MessageStatus = {}));
