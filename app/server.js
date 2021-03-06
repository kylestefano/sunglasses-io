var http = require('http');
var fs = require('fs');
var finalHandler = require('finalhandler');
var queryString = require('querystring');
var Router = require('router');
var bodyParser   = require('body-parser');
var uid = require('rand-token').uid;
const PORT = 3001;

const TOKEN_VALIDITY_TIMEOUT = 15 * 60 * 1000; // 15 minutes

let brands = [];
let products = [];
let users = [];
let accessTokens = [];
let failedLoginAttempts = {};

// Setup router
var myRouter = Router();
myRouter.use(bodyParser.json());

let server = http.createServer(function (request, response) {
    myRouter(request, response, finalHandler(request, response))
}).listen(PORT, (error) => {
    if (error) {
      return console.log('Error on Server Startup: ', error)
    }
    //Reads the brands.JSON file
    fs.readFile('./initial-data/brands.json', 'utf8', function (error, data) {
      if (error) throw error;
      brands = JSON.parse(data);
      console.log(`Server setup: ${brands.length} brands loaded`);
    });
    //Reads the products.JSON file
    fs.readFile('./initial-data/products.json', 'utf8', function (error, data) {
        if (error) throw error;
        products = JSON.parse(data);
        console.log(`Server setup: ${products.length} products loaded`);
    });
    fs.readFile('./initial-data/users.json', 'utf8', function (error, data) {
      if (error) throw error;
      users = JSON.parse(data);
      console.log(`Server setup: ${users.length} users loaded`);
    });
    
    console.log(`Server is listening on ${PORT}`);
  });

// Route to the brands. Should return all brands of sunglasses
myRouter.get('/api/brands', function(request,response){
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify(brands));
});
// Route to the products for a specific brand ID. Should return products offered for that brand
myRouter.get('/api/brands/:id/products', function(request,response){
    let productsWithBrandId = products.filter((product) => product.categoryId === request.params.id)

    if (productsWithBrandId.length === 0) {
		response.writeHead(404);	
		return response.end("Brand ID could not be found");
	}
    
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify(productsWithBrandId));
});

// Route to the products. Should return all products offered
myRouter.get('/api/products', function(request,response){
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify(products));
});

// Helpers to get/set our number of failed requests per username
var getNumberOfFailedLoginRequestsForUsername = function(username) {
  let currentNumberOfFailedRequests = failedLoginAttempts[username];
  if (currentNumberOfFailedRequests) {
    return currentNumberOfFailedRequests;
  } else {
    return 0;
  }
}

var setNumberOfFailedLoginRequestsForUsername = function(username,numFails) {
  failedLoginAttempts[username] = numFails;
}
// Login call
myRouter.post('/api/login', function(request,response) {
  // Make sure there is a username and password in the request
  if (request.body.username && request.body.password && getNumberOfFailedLoginRequestsForUsername(request.body.username) < 3) {
    // See if there is a user that has that username and password
    let user = users.find((user)=>{
      return user.login.username == request.body.username && user.login.password == request.body.password;
    });
    if (user) {
      // If we found a user, reset our counter of failed logins
      setNumberOfFailedLoginRequestsForUsername(request.body.username,0);

      // Write the header because we know we will be returning successful at this point and that the response will be json
      response.writeHead(200, {'Content-Type': 'application/json'});

      // We have a successful login, if we already have an existing access token, use that
      let currentAccessToken = accessTokens.find((tokenObject) => {
        return tokenObject.username == user.login.username;
      });

      // Update the last updated value so we get another time period before expiration
      if (currentAccessToken) {
        currentAccessToken.lastUpdated = new Date();
        return response.end(JSON.stringify(currentAccessToken.token));
      } else {
        // Create a new token with the user value and a "random" token
        let newAccessToken = {
          username: user.login.username,
          lastUpdated: new Date(),
          token: uid(16)
        }
        accessTokens.push(newAccessToken);
        return response.end(JSON.stringify(newAccessToken.token));
      }
    } else {
      // Update the number of failed login attempts
      let numFailedForUser = getNumberOfFailedLoginRequestsForUsername(request.body.username);
      setNumberOfFailedLoginRequestsForUsername(request.body.username,++numFailedForUser);
      // When a login fails, tell the client in a generic way that either the username or password was wrong
      response.writeHead(401, "Invalid username or password");
      return response.end();
    }
  } else {
    // If they are missing one of the parameters, tell the client that something was wrong in the formatting of the response
    response.writeHead(400, "Missing username or password");
    return response.end();
  }
});

var getValidTokenFromRequest = function(request) {
  var parsedUrl = require('url').parse(request.url,true)
  if (parsedUrl.query.accessToken) {
    // Verify the access token to make sure its valid and not expired
    let currentAccessToken = accessTokens.find((accessToken) => {
      return accessToken.token == parsedUrl.query.accessToken && ((new Date) - accessToken.lastUpdated) < TOKEN_VALIDITY_TIMEOUT;
    });
    if (currentAccessToken) {
      return currentAccessToken;
    } else {
      return null;
    }
  } else {
    return null;
  }
};

myRouter.get('/api/me/cart', function(request,response) {
  //verifying token
  let currentAccessToken = getValidTokenFromRequest(request);
  if (!currentAccessToken) {
    // If there isn't an access token in the request, we know that the user isn't logged in, so don't continue
    response.writeHead(401, "You need to log in to see cart");
    return response.end();
  } else {
    // Check if the username and login match has access to the users cart
      let user = users.find((user) => {
      return user.login.username == currentAccessToken.username;
    });
   
      response.writeHead(200, {"Content-Type": "application/json"});
      return response.end(JSON.stringify(user.cart));    
  }
});

myRouter.post('/api/me/cart', function(request,response) {
  //verifying token
  let currentAccessToken = getValidTokenFromRequest(request);
  if (!currentAccessToken) {
    // If there isn't an access token in the request, we know that the user isn't logged in, so don't continue
    response.writeHead(401, "You need to log in to add item to cart");
    return response.end();
  
  } else {
    
    //Find the correct user cart
    let user = users.find((user)=>{
      return user.login.username == currentAccessToken.username
  })
    // Checking to see if product exists in cart
    let productInCart = user.cart.find((product) => {
      return product.id === request.body.product.id
    })
    
    if (productInCart) {
      response.writeHead(405, "That product is aleady in cart");	
      return response.end();
    }

    let addedProduct = products.find((product) => {
      return product.id === request.body.id
    })

    addedProduct.quantity = 1

    //if the product is not already in the cart it adds the product to the cart 
    user.cart.push(addedProduct)

    // Return success with added product in cart
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify(user.cart));
    }
});

myRouter.put('/api/me/cart/:productId', function(request,response) {
  //verifying token
  let currentAccessToken = getValidTokenFromRequest(request);
  if (!currentAccessToken) {
    // If there isn't an access token in the request, we know that the user isn't logged in, so don't continue
    response.writeHead(401, "You need to log in to update item in cart");
    return response.end();
  
  } else {
    
    //Find the correct user cart
    let user = users.find((user)=>{
    return user.login.username == currentAccessToken.username
    })
    
    //If cart is empty
    if (user.cart.length === 0) {
      response.writeHead(403, "ERROR: Your cart is empty");
      return response.end();
    }

    let quantityWanted = request.body.quantity;
    if (quantityWanted < 1) {
        response.writeHead(405, "Invalid request. Quantity can't be Zero");
        return response.end();
    }
    
    
    let productToEdit = user.cart.find((product) => {
      return product.id === request.params.productId
    })

    productToEdit.quantity = quantityWanted

   
    // Return success with updated product in cart
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify(user.cart));
    }
});

myRouter.delete('/api/me/cart/:productId', function(request,response) {
  //verifying token
  let currentAccessToken = getValidTokenFromRequest(request);
  if (!currentAccessToken) {
    // If there isn't an access token in the request, we know that the user isn't logged in, so don't continue
    response.writeHead(401, "You need to log in to remove item from cart");
    return response.end();
  
  } else {
    
      //Find the correct user cart
      let user = users.find((user)=>{
        return user.login.username == currentAccessToken.username
      })

      if (user.cart.length === 0 ) {
        response.writeHead(403, "ERROR: Your cart is empty");
        return response.end();
      }
      // Checking to see if product exists in cart
      
      let productInCart = user.cart.find((product) => {
        return product.id === request.params.productId
      })

      if (!productInCart) {
        response.writeHead(404, "That product cannot be found");
        return response.end();
      }
      
      user.cart = user.cart.filter((product) => {
        return product.id !== request.params.productId
      })
      
      // Return success with added product in cart
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify(user.cart));
    }
});



module.exports = server;