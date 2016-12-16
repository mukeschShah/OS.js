/*!
 * OS.js - JavaScript Cloud/Web Desktop Platform
 *
 * Copyright (c) 2011-2016, Anders Evenrud <andersevenrud@gmail.com>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this
 *    list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
 * ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * @author  Anders Evenrud <andersevenrud@gmail.com>
 * @licence Simplified BSD License
 */

(function(Application, Window, Utils, VFS, GUI) {
  'use strict';

  /**
   * @namespace Broadway
   * @memberof OSjs.Helpers
   */

  var _connected = false;
  var _opened = false;
  var _ws = null;

  /////////////////////////////////////////////////////////////////////////////
  // HELPERS
  /////////////////////////////////////////////////////////////////////////////

  /*
   * Creates a new connection URL
   */
  function createURL(cfg) {
    var protocol = cfg.protocol || window.location.protocol.replace(/^http/, 'ws');
    var host = cfg.host || window.location.hostname;
    return protocol + '//' + host + ':' + cfg.port + '/' + cfg.uri;
  }

  /*
   * Get window
   */
  function actionOnWindow(id, cb) {
    var wm = OSjs.Core.getWindowManager();
    if ( wm ) {
      var win = wm.getWindow('BroadwayWindow' + id);
      if ( win ) {
        return cb(win);
      }
    }
    return null;
  }

  /*
   * Removes the notification icon
   */
  function removeNotification() {
    var wm = OSjs.Core.getWindowManager();
    if ( wm ) {
      wm.removeNotificationIcon('BroadwayService');
    }
  }

  /*
   * Updates notification icon based on state(s)
   */
  function updateNotification() {
    var wm = OSjs.Core.getWindowManager();
    if ( wm ) {
      var n = wm.getNotificationIcon('BroadwayService');
      if ( n ) {
        var icon = _opened || _connected ? 'network-transmit' : 'network-offline';
        var image = OSjs.API.getIcon('status/' + icon + '.png');
        n.setIcon(image);
      }
    }
  }

  /*
   * Creates the notification icon
   */
  function createNotification() {
    var wm = OSjs.Core.getWindowManager();
    var conf = OSjs.API.getConfig('Broadway');

    function displayMenu(ev) {
      var menuItems = [];
      if ( _connected ) {
        menuItems.push({
          title: 'Disconnect from Broadway server',
          onClick: function() {
            OSjs.Helpers.Broadway.disconnect();
          }
        });
        menuItems.push({
          title: 'Create new process',
          onClick: function() {
            OSjs.API.createDialog('Input', {}, function(ev, btn, value) {
              if ( btn === 'ok' && value ) {
                OSjs.Helpers.Broadway.spawn(value);
              }
            })
          }
        });
      } else {
        menuItems.push({
          title: 'Connect to Broadway server',
          onClick: function() {
            OSjs.Helpers.Broadway.connect();
          }
        });
      }

      OSjs.API.createMenu(menuItems, ev);
    }

    removeNotification();

    if ( wm && conf.enabled ) {
      removeNotification();

      wm.createNotificationIcon('BroadwayService', {
        image: OSjs.API.getIcon('status/network-offline.png'),
        onContextMenu: function(ev) {
          displayMenu(ev);
          return false;
        },
        onClick: function(ev) {
          displayMenu(ev);
          return false;
        }
      });
    }
  }

  /*
   * Creates a new Broadway connection
   */
  function createConnection(host, cb, cbclose) {
    window.Broadway.connect(host, {
      onSocketOpen: function() {
        _connected = true;
        createNotification();
      },

      onSocketClose: function() {
        _connected = false;
        createNotification();
      },

      onSetTransient: function(id, parentId, surface) {
        return actionOnWindow(parentId, function(win) {
          if ( win._canvas && surface.canvas ) {
            if ( win._canvas.parentNode ) {
              win._canvas.parentNode.appendChild(surface.canvas);
            }
          }
        });
      },

      /*
      onFlushSurface: function(id, q) {
        return actionOnWindow(id, function(win) {
          return win._canvas;
        });
      },
      */

      onDeleteSurface: function(id) {
        return actionOnWindow(id, function(win) {
          return win._close();
        });
      },

      onShowSurface: function(id) {
        return actionOnWindow(id, function(win) {
          return win._restore();
        });
      },

      onHideSurface: function(id) {
        return actionOnWindow(id, function(win) {
          return win._minimize();
        });
      },

      onMoveSurface: function(id, has_pos, has_size, surface) {
        return actionOnWindow(id, function(win) {
          //if ( has_pos ) {
          //  win._move(x, y);
          //}
          if ( has_size ) {
            win._resize(surface.width, surface.height);
          }
        });
      },

      onCreateSurface: function(id, surface) {
        var wm = OSjs.Core.getWindowManager();
        var win = new OSjs.Helpers.BroadwayWindow(id, surface.x, surface.y, surface.width, surface.height);
        wm.addWindow(win);
        return win._canvas;
      }

    }, cb, cbclose);
  }

  /*
   * Destroys Broadway connection
   */
  function destroyConnection() {
    if ( !_opened ) {
      return;
    }
    _opened = false;

    try {
      window.Broadway.disconnect();
    } catch ( e ) {
      console.warn(e);
    }

    setTimeout(function() {
      updateNotification();
    }, 100);
  }

  /*
   * Creates a new Spawner connection
   */
  function createSpawner(host, cb) {
    _ws = new WebSocket(host, 'broadway-spawner');

    _ws.onerror = function() {
      cb('Failed to connect to spawner');
    };

    _ws.onopen = function() {
      cb(null, _ws)
    };

    _ws.onclose = function() {
      destroyConnection();
    };
  }

  /*
   * Destroys Spawner connection
   */
  function destroySpawner() {
    if ( _ws ) {
      _ws.close();
    }
    _ws = null;

    setTimeout(function() {
      updateNotification();
    }, 100);
  }

  /////////////////////////////////////////////////////////////////////////////
  // API
  /////////////////////////////////////////////////////////////////////////////

  var Broadway = {
    /**
     * Creates a new Broadway connection
     *
     * @function connect
     * @memberof OSjs.Helpers.Broadway
     */
    connect: function() {
      if ( _connected || _ws ) {
        return;
      }

      var conf = OSjs.API.getConfig('Broadway');

      createSpawner(createURL(conf.defaults.spawner), function(err) {
        if ( err ) {
          console.error(err);
        } else {
          try {
            createConnection(createURL(conf.defaults.connection), function() {
              _opened = true;

              updateNotification();
            }, function() {
              destroySpawner();
              destroyConnection();
            });
          } catch ( e ) {
            console.warn(e);
          }
        }
      });
    },

    /**
     * Disconnects the Broadway connection
     *
     * @function disconnect
     * @memberof OSjs.Helpers.Broadway
     */
    disconnect: function() {
      destroyConnection();
    },

    /**
     * Spawns a new process on the Broadway server
     *
     * @param {String}  cmd     Command
     *
     * @function spawn
     * @memberof OSjs.Helpers.Broadway
     */
    spawn: function(cmd) {
      if ( !_connected || !_ws ) {
        return;
      }

      _ws.send(JSON.stringify({
        method: 'launch',
        argument: cmd
      }));
    }
  };

  /////////////////////////////////////////////////////////////////////////////
  // EXPORTS
  /////////////////////////////////////////////////////////////////////////////

  if ( OSjs.API.getConfig('Broadway.enabled') ) {
    OSjs.API.addHook('onSessionLoaded', function() {
      createNotification();
    });

    OSjs.API.addHook('onLogout', function() {
      removeNotification();
      destroySpawner();
      destroyConnection();
    });
  }

  OSjs.Helpers.Broadway = Broadway;

})(OSjs.Core.Application, OSjs.Core.Window, OSjs.Utils, OSjs.VFS, OSjs.GUI);
