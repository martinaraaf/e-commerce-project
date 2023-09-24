import { orderModel } from '../../../DB/Models/order.model.js'
import { productModel } from '../../../DB/Models/product.model.js'
import { reviewModel } from '../../../DB/Models/review.model.js'

//============================ add review ================
export const addReview = async (req, res, next) => {
  const userId = req.authUser._id
  const { productId } = req.query

  // ================================= check  procduct ===================
  const isProductValidToBeReviewd = await orderModel.findOne({
    userId,
    'products.productId': productId,
    orderStatus: 'delivered',
  })
  if (!isProductValidToBeReviewd) {
    return next(new Error('you should buy the product first', { cause: 400 }))
  }

  const { reviewRate, reviewComment } = req.body
  const reviewObject = {
    userId,
    productId,
    reviewComment,
    reviewRate,
  }
  const reviewDB = await reviewModel.create(reviewObject)
  if (!reviewDB) {
    return next(new Error('fail to add review', { cause: 500 }))
  }

  const product = await productModel.findById(productId)
  const reviews = await reviewModel.find({ productId })
  let sumOfRates = 0
  for (const review of reviews) {
    sumOfRates += review.reviewRate
  }
  product.rate = Number(sumOfRates / reviews.length).toFixed(2)
  await product.save()
  
  res.status(201).json({ message: 'Done', reviewDB, product })
}

// overall rate = sum of rates(reviews) / number of rate
