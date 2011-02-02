$(document).ready(function($) {
    
    // size elements
    $(window).bind("load resize", function() {
        var h = $(window).height();
        var w = $(window).width();
        $("li.messageTo, li.messageFrom").css({ "width" : w-84 });
    });   

}); 
