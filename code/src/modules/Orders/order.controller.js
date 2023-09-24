import { nanoid } from 'nanoid'
import { cartModel } from '../../../DB/Models/cart.model.js'
import { couponModel } from '../../../DB/Models/coupon.model.js'
import { orderModel } from '../../../DB/Models/order.model.js'
import { productModel } from '../../../DB/Models/product.model.js'
import { couponValidationFunction } from '../../utils/couponValidation.js'
import createInvoice from '../../utils/pdfkit.js'
import { sendEmailService } from '../../services/sendEmailService.js'
import { qrCodeFunction } from '../../utils/qrCodeFunction.js'
import { paymentFunction } from '../../utils/payment.js'
import { generateToken, verifyToken } from '../../utils/tokenFunctions.js'
import Stripe from 'stripe'

//=============================== create order ===============
export const createOrder = async (req, res, next) => {
  const userId = req.authUser._id
  const {
    address,
    phoneNumbers,
    productId,
    quantity,
    paymentMethod,
    couponCode,
  } = req.body

  //=================== couponCode check ==============
  if (couponCode) {
    const coupon = await couponModel
      .findOne({ couponCode })
      .select('isFixedAmount isPercentage couponAmount couponAssginedToUsers')
    const isCouponValid = await couponValidationFunction({
      couponCode,
      userId,
      next,
    }) // TODO: some fixes
    console.log(isCouponValid)
    console.log(isCouponValid !== true)
    if (isCouponValid !== true) {
      return next(new Error(isCouponValid.msg, { cause: 400 }))
    }
    req.coupon = coupon
  }

  // ================== products checks ============
  const product = await productModel.findOne({
    _id: productId,
    stock: { $gte: quantity },
  })
  if (!product) {
    return next(new Error('not valid product', { cause: 400 }))
  }

  const products = []
  products.push({
    productId,
    quantity,
    title: product.title,
    price: product.priceAfterDiscount,
    finalPrice: product.priceAfterDiscount * quantity,
  })

  // ===================== subTotal =================
  const subTotal = product.priceAfterDiscount * quantity
  if (
    req.coupon?.isFixedAmount &&
    req.coupon?.couponAmount > product.priceAfterDiscount
  ) {
    return next(new Error('please select another product', { cause: 400 }))
  }
  //===================== paidAmount ================
  let paidAmount
  if (req.coupon?.isPercentage) {
    paidAmount = subTotal * (1 - (req.coupon?.couponAmount || 0) / 100)
  } else if (req.coupon?.isFixedAmount) {
    paidAmount = subTotal - req.coupon.couponAmount
  } else {
    paidAmount = subTotal
  }

  //===================== orderStatus + paymentMethod ================
  let orderStatus
  paymentMethod == 'cash' ? (orderStatus = 'placed') : (orderStatus = 'pending')

  const orderObject = {
    userId,
    products,
    subTotal,
    paidAmount,
    couponId: req.coupon?._id,
    address,
    phoneNumbers,
    paymentMethod,
    orderStatus,
  }

  const orderDB = await orderModel.create(orderObject)
  if (!orderDB) {
    return next(new Error('fail to order', { cause: 400 }))
  }
  // ======================= payment ================================
  let orderSession
  if (orderDB.paymentMethod == 'card') {
    if (req.coupon) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
      let coupon
      if (req.coupon.isPercentage) {
        coupon = await stripe.coupons.create({
          percent_off: req.coupon.couponAmount,
        })
      }
      if (req.coupon.isFixedAmount) {
        coupon = await stripe.coupons.create({
          amount_off: req.coupon.couponAmount * 100,
          currency: 'EGP',
        })
      }
      req.couponId = coupon.id
    }
    const tokenOrder = generateToken({
      payload: { orderId: orderDB._id },
      signature: process.env.ORDER_TOKEN,
      expiresIn: '1h',
    })
    orderSession = await paymentFunction({
      payment_method_types: [orderDB.paymentMethod],
      mode: 'payment',
      customer_email: req.authUser.email,
      metadata: { orderId: orderDB._id.toString() },
      success_url: `${req.protocol}://${req.headers.host}/order/successOrder?token=${tokenOrder}`,
      cancel_url: `${req.protocol}://${req.headers.host}/order/cancelOrder?token=${tokenOrder}`,
      line_items: orderDB.products.map((ele) => {
        return {
          price_data: {
            currency: 'EGP',
            product_data: {
              name: ele.title,
            },
            unit_amount: ele.price * 100,
          },
          quantity: ele.quantity,
        }
      }),
      discounts: req.couponId ? [{ coupon: req.couponId }] : [],
    })
  }

  // =========================== invoice generation =====================
  // const orderCode = `${req.authUser.userName}_${nanoid(3)}`
  // const orderinvoice = {
  //   orderCode,
  //   date: orderDB.createdAt,
  //   shipping: {
  //     name: req.authUser.userName,
  //     address: orderDB.address,
  //     city: 'Cairo',
  //     country: 'cairo',
  //     state: 'Cairo',
  //   },
  //   items: orderDB.products,
  //   subTotal: orderDB.subTotal,
  //   paidAmount: orderDB.paidAmount,
  // }
  // await createInvoice(orderinvoice, `${orderCode}.pdf`)
  // const isEmailSent = await sendEmailService({
  //   to: req.authUser.email,
  //   subject: 'Order Confirmation',
  //   message: `<h1>please find your invoice attachment below</h1>`,
  //   attachments: [
  //     {
  //       path: `./Files/${orderCode}.pdf`,
  //     },
  //   ],
  // })
  // if (!isEmailSent) {
  //   return next(new Error('email fail', { cause: 500 }))
  // }

  //======================================= QRcode ==================
  const orderQr = await qrCodeFunction({
    data: { orderId: orderDB._id, products: orderDB.products },
  })
  // decrease products stock by quantity
  await productModel.findOneAndUpdate(
    { _id: productId },
    {
      //   stock,inc
      $inc: { stock: -parseInt(quantity) },
    },
  )
  // increase coupon Usage
  if (req.coupon) {
    for (const user of req.coupon?.couponAssginedToUsers) {
      if (user.userId.toString() == userId.toString()) {
        user.usageCount += 1
      }
    }
    await req.coupon.save()
  }

  res.status(201).json({
    message: 'Done',
    orderDB,
    orderQr,
    checkOutUrl: orderSession.url,
  })
}

//============================== convert cart to order ===============
export const fromCartToOrde = async (req, res, next) => {
  const { cartId } = req.query
  const userId = req.authUser._id

  const { paymentMethod, address, phoneNumbers, couponCode } = req.body
  const cart = await cartModel.findById(cartId)
  if (!cart || !cart.products.length) {
    return next(new Error('please add products to your cart', { cause: 400 }))
  }
  //=================== couponCode check ==============
  if (couponCode) {
    const coupon = await couponModel
      .findOne({ couponCode })
      .select('isFixedAmount isPercentage couponAmount couponAssginedToUsers')
    const isCouponValid = await couponValidationFunction({
      couponCode,
      userId,
      next,
    }) // TODO: some fixes
    // console.log(isCouponValid)
    if (!isCouponValid == true) {
      return isCouponValid
    }
    req.coupon = coupon
  }

  //=============== products=================
  let products = []
  for (const product of cart.products) {
    const productExist = await productModel.findById(product.productId)
    products.push({
      productId: product.productId,
      quantity: product.quantity,
      title: productExist.title,
      price: productExist.priceAfterDiscount,
      finalPrice: productExist.priceAfterDiscount * product.quantity,
    })
  }

  //=============== subTotal ==============
  const subTotal = cart.subTotal

  //===================== paidAmount ================
  let paidAmount
  if (req.coupon?.isPercentage) {
    paidAmount = subTotal * (1 - (req.coupon?.couponAmount || 0) / 100)
  } else if (req.coupon?.isFixedAmount) {
    paidAmount = subTotal - req.coupon.couponAmount
  } else {
    paidAmount = subTotal
  }

  //===================== orderStatus + paymentMethod ================
  let orderStatus
  paymentMethod == 'cash' ? (orderStatus = 'placed') : (orderStatus = 'pending')

  const orderObject = {
    userId,
    products,
    subTotal,
    paidAmount,
    couponId: req.coupon?._id,
    address,
    phoneNumbers,
    paymentMethod,
    orderStatus,
  }

  const orderDB = await orderModel.create(orderObject)
  if (!orderDB) {
    return next(new Error('fail to order'))
  }
  // ======================= payment ================================
  let orderSession
  if (orderDB.paymentMethod == 'card') {
    if (req.coupon) {
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
      let coupon
      if (req.coupon.isPercentage) {
        coupon = await stripe.coupons.create({
          percent_off: req.coupon.couponAmount,
        })
      }
      if (req.coupon.isFixedAmount) {
        coupon = await stripe.coupons.create({
          amount_off: req.coupon.couponAmount * 100,
          currency: 'EGP',
        })
      }
      req.couponId = coupon.id
    }
    const tokenOrder = generateToken({
      payload: { orderId: orderDB._id },
      signature: process.env.ORDER_TOKEN,
      expiresIn: '1h',
    })
    orderSession = await paymentFunction({
      payment_method_types: [orderDB.paymentMethod],
      mode: 'payment',
      customer_email: req.authUser.email,
      metadata: { orderId: orderDB._id.toString() },
      success_url: `${req.protocol}://${req.headers.host}/order/successOrder?token=${tokenOrder}`,
      cancel_url: `${req.protocol}://${req.headers.host}/order/cancelOrder?token=${tokenOrder}`,
      line_items: orderDB.products.map((ele) => {
        return {
          price_data: {
            currency: 'EGP',
            product_data: {
              name: ele.title,
            },
            unit_amount: ele.price * 100,
          },
          quantity: ele.quantity,
        }
      }),
      discounts: req.couponId ? [{ coupon: req.couponId }] : [],
    })
  }

  // =========================== invoice generation =====================
  const orderCode = `${req.authUser.userName}_${nanoid(3)}`
  const orderinvoice = {
    orderCode,
    date: orderDB.createdAt,
    shipping: {
      name: req.authUser.userName,
      address: orderDB.address,
      city: 'Cairo',
      country: 'cairo',
      state: 'Cairo',
    },
    items: orderDB.products,
    subTotal: orderDB.subTotal,
    paidAmount: orderDB.paidAmount,
  }
  await createInvoice(orderinvoice, `${orderCode}.pdf`)
  const isEmailSent = await sendEmailService({
    to: req.authUser.email,
    subject: 'Order Confirmation',
    message: `<h1>please find your invoice attachment below</h1>`,
    attachments: [
      {
        path: `./Files/${orderCode}.pdf`,
      },
    ],
  })
  if (!isEmailSent) {
    return next(new Error('email fail', { cause: 500 }))
  }
  // decrease products stock by quantity
  for (const product of cart.products) {
    await productModel.findOneAndUpdate(
      { _id: product.productId },
      {
        $inc: { stock: -parseInt(product.quantity) },
      },
    )
  }
  // increase coupon Usage
  if (req.coupon) {
    for (const user of req.coupon?.couponAssginedToUsers) {
      if (user.userId.toString() == userId.toString()) {
        user.usageCount += 1
      }
    }
    await req.coupon.save()
  }

  cart.products = []
  await cart.save()
  res.status(201).json({ message: 'done', orderDB, cart })
}

// ============================= success payment  ===================
export const successPayment = async (req, res, next) => {
  const { token } = req.query
  const decodeData = verifyToken({ token, signature: process.env.ORDER_TOKEN })
  const order = await orderModel.findOne({
    _id: decodeData.orderId,
    orderStatus: 'pending',
  })
  if (!order) {
    return next(new Error('invalid order id', { cause: 400 }))
  }
  order.orderStatus = 'confirmed'
  await order.save()
  res.status(200).json({ message: 'done', order })
}

//================================ cancel payment =====================
export const cancelPayment = async (req, res, next) => {
  const { token } = req.query
  const decodeData = verifyToken({ token, signature: process.env.ORDER_TOKEN })
  const order = await orderModel.findOne({ _id: decodeData.orderId })
  if (!order) {
    return next(new Error('invalid order id', { cause: 400 }))
  }

  //=============== approch one orderSattus:'canceled'
  order.orderStatus = 'canceled'
  await order.save()
  //================ delete from db
  // await orderModel.findOneAndDelete({ _id: decodeData.orderId })

  //=================== undo prouducts  and coupon  ====================
  for (const product of order.products) {
    await productModel.findByIdAndUpdate(product.productId, {
      $inc: { stock: parseInt(product.quantity) },
    })
  }

  if (order.couponId) {
    const coupon = await couponModel.findById(order.couponId)
    if (!coupon) {
      return next(new Error('invalid coupon id'))
    }
    coupon.couponAssginedToUsers.map((ele) => {
      if (order.userId.toString() == ele.userId.toString()) {
        ele.usageCount -= 1
      }
    })

    await coupon.save()
  }
  res.status(200).json({ message: 'done', order })
}

// ================================ mark teh order as delivered ===================
export const deliverOrder = async (req, res, next) => {
  const { orderId } = req.query

  const order = await orderModel.findOneAndUpdate(
    {
      _id: orderId,
      orderStatus: { $nin: ['delivered', 'pending', 'canceled', 'rejected'] },
    },
    {
      orderStatus: 'delivered',
    },
    {
      new: true,
    },
  )

  if (!order) {
    return next(new Error('invalid order', { cause: 400 }))
  }

 return res.status(200).json({ message: 'Done', order })
}



// break 8:05